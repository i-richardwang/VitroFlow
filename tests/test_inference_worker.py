from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from vitroflow import worker_session
from vitroflow.annotations import BoundingBox
from vitroflow.detectors import (
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    RuntimeDescriptor,
)
from vitroflow.inference_models import ModelManifest
from vitroflow.inference_worker import Assignment, InferenceClient, run_pass
from vitroflow.worker_session import LeaseLostError, WorkerClient, WorkerSession

RUNTIME = RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64)
IMAGE = b"source"
DIGEST = hashlib.sha256(IMAGE).hexdigest()
MANIFEST = {
    "schemaVersion": 1,
    "modelVersionId": "set.traditional-v1",
    "classes": ["seed"],
    "artifact": {"kind": "traditional", "digest": "a" * 64},
}
OTHER_MANIFEST = {
    "schemaVersion": 1,
    "modelVersionId": "set.traditional-v2",
    "classes": ["seed"],
    "artifact": {"kind": "traditional", "digest": "c" * 64},
}


class FakeDetector:
    artifact_digest = "a" * 64
    runtime = RUNTIME

    def predict(
        self, image_path: Path, digest: str, producer: DetectionProducer
    ) -> DetectionResult:
        assert image_path.read_bytes() == IMAGE
        assert image_path.name == f"{digest}{image_path.suffix}"
        return DetectionResult(
            digest,
            100,
            80,
            producer,
            (DetectionInstance("1", "seed", BoundingBox(10, 20, 8, 6), 0.9),),
            DetectionQuality("ok"),
        )


class FailingDetector(FakeDetector):
    def predict(
        self, image_path: Path, digest: str, producer: DetectionProducer
    ) -> DetectionResult:
        raise ValueError("dish not found")


class FakeStore:
    """Serves one detector per version id and refuses the others."""

    def __init__(self, detectors: dict[str, Any]) -> None:
        self.detectors = detectors
        self.loads: list[str] = []

    def load(self, manifest: ModelManifest) -> Any:
        version_id = manifest.model_version_id
        self.loads.append(version_id)
        if version_id not in self.detectors:
            raise RuntimeError(f"no weights for {version_id}")
        return self.detectors[version_id]


DETECTOR = FakeDetector()
SESSION = WorkerSession(
    "test-worker", "test-session", "2026-08-27T00:00:00+00:00", (RUNTIME,), 8_192
)
PRODUCER = DetectionProducer("set.traditional-v1", "a" * 64, RUNTIME)


def store(detector: Any = DETECTOR) -> FakeStore:
    return FakeStore({"set.traditional-v1": detector})


class Workbench:
    def __init__(
        self,
        assignments: list[dict[str, Any]],
        *,
        result_status: int = 200,
        lease_status: int = 200,
        lease_statuses: list[int] | None = None,
        image: bytes = IMAGE,
    ) -> None:
        self.assignments = list(assignments)
        self.result_status = result_status
        self.lease_status = lease_status
        self.lease_statuses = list(lease_statuses or [])
        self.image = image
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["authorization"] == "Bearer secret"
        path = request.url.path
        if path == "/api/worker/heartbeat":
            return httpx.Response(200)
        if path == "/api/worker/inference/claim":
            assignment = self.assignments.pop(0) if self.assignments else None
            return httpx.Response(200, json={"assignment": assignment})
        if path.startswith("/api/worker/inference/claims/") and path.endswith("/lease"):
            status = (
                self.lease_statuses.pop(0) if self.lease_statuses else self.lease_status
            )
            return httpx.Response(status, json={})
        if path.startswith("/api/worker/inference/images/"):
            return httpx.Response(200, content=self.image)
        if path.startswith("/api/worker/inference/results/"):
            return httpx.Response(self.result_status, json={})
        return httpx.Response(404)

    def client(self) -> InferenceClient:
        return InferenceClient(
            WorkerClient(
                "https://example.test",
                "secret",
                SESSION,
                transport=httpx.MockTransport(self),
            )
        )

    def calls(self) -> list[tuple[str, str]]:
        return [(request.method, request.url.path) for request in self.requests]

    def result_bodies(self) -> list[dict[str, object]]:
        return [
            json.loads(request.read())
            for request in self.requests
            if request.method == "PUT"
        ]


ASSIGNMENTS = [{"manifest": MANIFEST, "image": DIGEST}]


def test_assignment_image_is_a_digest() -> None:
    with pytest.raises(ValueError, match=r"assignment.image.*shared contract"):
        Assignment.parse(
            {
                "manifest": MANIFEST,
                "image": "images/set/a.jpg",
            }
        )
    with pytest.raises(ValueError, match=r"assignment.image.*shared contract"):
        Assignment.parse(
            {
                "manifest": MANIFEST,
                "image": {"digest": DIGEST},
            }
        )


@pytest.mark.parametrize(
    ("filename", "kind"),
    [
        ("inference-assignment.json", "traditional"),
        ("inference-assignment-yolo.json", "ultralytics"),
    ],
)
def test_assignment_loads_shared_contract_fixtures(filename: str, kind: str) -> None:
    fixture = Path(__file__).parent / "fixtures/contracts" / filename
    assignment = Assignment.parse(json.loads(fixture.read_text()))
    assert assignment.manifest.artifact["kind"] == kind
    assert assignment.image in {"c" * 64, "d" * 64}


def test_assignment_validates_its_manifest() -> None:
    with pytest.raises(
        ValueError, match=r"assignment.manifest.artifact.*shared contract"
    ):
        Assignment.parse(
            {
                "manifest": {
                    "schemaVersion": 1,
                    "modelVersionId": "set.v1",
                    "classes": ["seed"],
                    "artifact": {"kind": "onnx", "digest": "a" * 64},
                },
                "image": DIGEST,
            }
        )
    with pytest.raises(
        ValueError, match=r"assignment.manifest.modelVersionId.*shared contract"
    ):
        Assignment.parse(
            {
                "manifest": {
                    "schemaVersion": 1,
                    "modelVersionId": "/set",
                    "classes": ["seed"],
                    "artifact": {"kind": "traditional", "digest": "a" * 64},
                },
                "image": DIGEST,
            }
        )


def test_heartbeat_describes_what_the_session_can_do() -> None:
    assert SESSION.heartbeat() == {
        "workerId": "test-worker",
        "sessionId": "test-session",
        "startedAt": "2026-08-27T00:00:00+00:00",
        "runtimes": [RUNTIME.to_dict()],
        "memoryBytes": 8_192,
    }


def test_pass_detects_one_claimed_image(tmp_path: Path) -> None:
    workbench = Workbench(ASSIGNMENTS)
    client = workbench.client()
    models = store()
    try:
        run_pass(client, tmp_path, models)
    finally:
        client.worker.close()

    assert workbench.calls() == [
        ("POST", "/api/worker/inference/claim"),
        (
            "POST",
            f"/api/worker/inference/claims/set.traditional-v1/{DIGEST}/lease",
        ),
        ("GET", f"/api/worker/inference/images/{DIGEST}"),
        ("PUT", f"/api/worker/inference/results/set.traditional-v1/{DIGEST}"),
    ]
    assert models.loads == ["set.traditional-v1"]
    assert json.loads(workbench.requests[0].read()) == {
        "workerId": "test-worker",
        "sessionId": "test-session",
    }
    assert json.loads(workbench.requests[1].read()) == {
        "workerId": "test-worker",
        "sessionId": "test-session",
    }
    assert dict(workbench.requests[3].url.params) == {
        "workerId": "test-worker",
        "sessionId": "test-session",
    }
    for body in workbench.result_bodies():
        assert body["schemaVersion"] == 1
        assert body["image"] == {"digest": DIGEST, "width": 100, "height": 80}
        assert body["producer"] == PRODUCER.to_dict()
    assert list(tmp_path.iterdir()) == []


def test_pass_skips_versions_it_cannot_load(tmp_path: Path) -> None:
    workbench = Workbench(
        [
            {
                "manifest": OTHER_MANIFEST,
                "image": DIGEST,
            },
            {"manifest": MANIFEST, "image": DIGEST},
        ]
    )
    client = workbench.client()
    models = store()
    try:
        run_pass(client, tmp_path, models)
        run_pass(client, tmp_path, models)
    finally:
        client.worker.close()
    assert models.loads == ["set.traditional-v2", "set.traditional-v1"]
    assert [body["producer"] for body in workbench.result_bodies()] == [
        PRODUCER.to_dict()
    ]


def test_pass_rejects_images_that_fail_digest_verification(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST}],
        image=b"tampered",
    )
    client = workbench.client()
    try:
        with pytest.raises(ValueError, match="digest verification"):
            run_pass(client, tmp_path, store())
    finally:
        client.worker.close()
    assert workbench.result_bodies() == []


def test_pass_records_a_failure_document(tmp_path: Path) -> None:
    workbench = Workbench([{"manifest": MANIFEST, "image": DIGEST}])
    client = workbench.client()
    try:
        run_pass(client, tmp_path, store(FailingDetector()))
    finally:
        client.worker.close()
    assert workbench.result_bodies() == [
        {
            "schemaVersion": 1,
            "image": {"digest": DIGEST},
            "producer": PRODUCER.to_dict(),
            "error": "dish not found",
        }
    ]


@pytest.mark.parametrize("status", [400, 422])
def test_pass_surfaces_a_refused_result(tmp_path: Path, status: int) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST}],
        result_status=status,
    )
    client = workbench.client()
    try:
        with pytest.raises(httpx.HTTPStatusError):
            run_pass(client, tmp_path, store())
    finally:
        client.worker.close()


def test_pass_surfaces_a_lost_lease(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST}],
        lease_status=409,
    )
    client = workbench.client()
    try:
        with pytest.raises(LeaseLostError):
            run_pass(client, tmp_path, store())
    finally:
        client.worker.close()


def test_refresh_failure_prevents_a_stale_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class SlowDetector(FakeDetector):
        def predict(
            self, image_path: Path, digest: str, producer: DetectionProducer
        ) -> DetectionResult:
            time.sleep(0.02)
            return super().predict(image_path, digest, producer)

    monkeypatch.setattr(worker_session, "LEASE_REFRESH_SECONDS", 0.001)
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST}],
        lease_statuses=[200, 409],
    )
    client = workbench.client()
    try:
        with pytest.raises(LeaseLostError):
            run_pass(client, tmp_path, store(SlowDetector()))
    finally:
        client.worker.close()
    assert workbench.result_bodies() == []


def test_result_conflict_is_a_lost_lease(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST}],
        result_status=409,
    )
    client = workbench.client()
    try:
        with pytest.raises(LeaseLostError):
            run_pass(client, tmp_path, store())
    finally:
        client.worker.close()


def test_pass_does_nothing_when_no_work_is_claimed(tmp_path: Path) -> None:
    workbench = Workbench([])
    client = workbench.client()
    try:
        run_pass(client, tmp_path, store())
    finally:
        client.worker.close()
    assert workbench.calls() == [("POST", "/api/worker/inference/claim")]


def test_pass_stops_before_starting_another_image(tmp_path: Path) -> None:
    workbench = Workbench(ASSIGNMENTS)
    client = workbench.client()
    stopped = threading.Event()
    stopped.set()
    try:
        run_pass(client, tmp_path, store(), stopped=stopped)
    finally:
        client.worker.close()

    assert workbench.calls() == []
