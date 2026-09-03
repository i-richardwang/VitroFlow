from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from vitroflow import inference_worker
from vitroflow.annotations import BoundingBox
from vitroflow.detectors import (
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    RuntimeDescriptor,
)
from vitroflow.inference_models import ModelManifest
from vitroflow.inference_worker import (
    Assignment,
    InferenceLeaseLostError,
    WorkerClient,
    WorkerRuntime,
    run_pass,
)

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
        self.loaded: str | None = None
        self.loads: list[str] = []

    def load(self, manifest: ModelManifest) -> Any:
        version_id = manifest.model_version_id
        self.loads.append(version_id)
        if version_id not in self.detectors:
            raise RuntimeError(f"no weights for {version_id}")
        self.loaded = version_id
        return self.detectors[version_id]


DETECTOR = FakeDetector()
WORKER = WorkerRuntime(
    "test-worker", "test-session", "2026-08-27T00:00:00+00:00", (RUNTIME,)
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
        if path == "/api/inference/heartbeat":
            return httpx.Response(200)
        if path == "/api/inference/claim":
            assignment = self.assignments.pop(0) if self.assignments else None
            return httpx.Response(200, json={"assignment": assignment})
        if path.startswith("/api/inference/claims/") and path.endswith("/lease"):
            status = (
                self.lease_statuses.pop(0) if self.lease_statuses else self.lease_status
            )
            return httpx.Response(status, json={})
        if path.startswith("/api/inference/images/"):
            return httpx.Response(200, content=self.image)
        if path.startswith("/api/inference/results/"):
            return httpx.Response(self.result_status, json={})
        return httpx.Response(404)

    def client(self) -> WorkerClient:
        return WorkerClient(
            "https://example.test",
            "secret",
            WORKER,
            transport=httpx.MockTransport(self),
        )

    def calls(self) -> list[tuple[str, str]]:
        return [(request.method, request.url.path) for request in self.requests]

    def heartbeats(self) -> list[dict[str, object]]:
        return [
            json.loads(request.read())
            for request in self.requests
            if request.url.path == "/api/inference/heartbeat"
        ]

    def result_bodies(self) -> list[dict[str, object]]:
        return [
            json.loads(request.read())
            for request in self.requests
            if request.method == "PUT"
        ]


LEASE = "2026-09-03T12:05:00.000Z"
ASSIGNMENTS = [{"manifest": MANIFEST, "image": DIGEST, "leaseExpiresAt": LEASE}]


def test_assignment_image_is_a_digest() -> None:
    with pytest.raises(ValueError, match=r"assignment.image.*shared contract"):
        Assignment.parse(
            {
                "manifest": MANIFEST,
                "image": "images/set/a.jpg",
                "leaseExpiresAt": LEASE,
            }
        )
    with pytest.raises(ValueError, match=r"assignment.image.*shared contract"):
        Assignment.parse(
            {
                "manifest": MANIFEST,
                "image": {"digest": DIGEST},
                "leaseExpiresAt": LEASE,
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
                "leaseExpiresAt": LEASE,
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
                "leaseExpiresAt": LEASE,
            }
        )
    with pytest.raises(ValueError, match=r"assignment.leaseExpiresAt.*shared contract"):
        Assignment.parse(
            {
                "manifest": MANIFEST,
                "image": DIGEST,
                "leaseExpiresAt": "2026-09-03T12:05:00",
            }
        )


def test_heartbeat_describes_runtimes_and_loaded_version() -> None:
    heartbeat = WORKER.heartbeat("set.traditional-v1", DIGEST)
    assert heartbeat == {
        "workerId": "test-worker",
        "sessionId": "test-session",
        "startedAt": "2026-08-27T00:00:00+00:00",
        "runtimes": [RUNTIME.to_dict()],
        "loaded": "set.traditional-v1",
        "current": DIGEST,
    }
    assert WORKER.heartbeat(None, None)["loaded"] is None


def test_pass_detects_one_claimed_image(tmp_path: Path) -> None:
    workbench = Workbench(ASSIGNMENTS)
    client = workbench.client()
    models = store()
    try:
        run_pass(client, tmp_path, models)
    finally:
        client.close()

    assert workbench.calls() == [
        ("POST", "/api/inference/heartbeat"),
        ("POST", "/api/inference/claim"),
        (
            "POST",
            f"/api/inference/claims/set.traditional-v1/{DIGEST}/lease",
        ),
        ("POST", "/api/inference/heartbeat"),
        ("GET", f"/api/inference/images/{DIGEST}"),
        ("PUT", f"/api/inference/results/set.traditional-v1/{DIGEST}"),
        ("POST", "/api/inference/heartbeat"),
    ]
    assert models.loads == ["set.traditional-v1"]
    assert [beat["loaded"] for beat in workbench.heartbeats()] == [
        None,
        "set.traditional-v1",
        "set.traditional-v1",
    ]
    assert json.loads(workbench.requests[1].read()) == {
        "workerId": "test-worker",
        "sessionId": "test-session",
    }
    assert json.loads(workbench.requests[2].read()) == {
        "workerId": "test-worker",
        "sessionId": "test-session",
    }
    assert dict(workbench.requests[5].url.params) == {
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
                "leaseExpiresAt": LEASE,
            },
            {"manifest": MANIFEST, "image": DIGEST, "leaseExpiresAt": LEASE},
        ]
    )
    client = workbench.client()
    models = store()
    try:
        run_pass(client, tmp_path, models)
        run_pass(client, tmp_path, models)
    finally:
        client.close()
    assert models.loads == ["set.traditional-v2", "set.traditional-v1"]
    assert [body["producer"] for body in workbench.result_bodies()] == [
        PRODUCER.to_dict()
    ]


def test_pass_rejects_images_that_fail_digest_verification(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST, "leaseExpiresAt": LEASE}],
        image=b"tampered",
    )
    client = workbench.client()
    try:
        with pytest.raises(ValueError, match="digest verification"):
            run_pass(client, tmp_path, store())
    finally:
        client.close()
    assert workbench.result_bodies() == []


def test_pass_records_a_failure_document(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST, "leaseExpiresAt": LEASE}]
    )
    client = workbench.client()
    try:
        run_pass(client, tmp_path, store(FailingDetector()))
    finally:
        client.close()
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
        [{"manifest": MANIFEST, "image": DIGEST, "leaseExpiresAt": LEASE}],
        result_status=status,
    )
    client = workbench.client()
    try:
        with pytest.raises(httpx.HTTPStatusError):
            run_pass(client, tmp_path, store())
    finally:
        client.close()


def test_pass_surfaces_a_lost_lease(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST, "leaseExpiresAt": LEASE}],
        lease_status=409,
    )
    client = workbench.client()
    try:
        with pytest.raises(InferenceLeaseLostError):
            run_pass(client, tmp_path, store())
    finally:
        client.close()


def test_refresh_failure_prevents_a_stale_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class SlowDetector(FakeDetector):
        def predict(
            self, image_path: Path, digest: str, producer: DetectionProducer
        ) -> DetectionResult:
            time.sleep(0.02)
            return super().predict(image_path, digest, producer)

    monkeypatch.setattr(inference_worker, "LEASE_REFRESH_SECONDS", 0.001)
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST, "leaseExpiresAt": LEASE}],
        lease_statuses=[200, 409],
    )
    client = workbench.client()
    try:
        with pytest.raises(InferenceLeaseLostError):
            run_pass(client, tmp_path, store(SlowDetector()))
    finally:
        client.close()
    assert workbench.result_bodies() == []


def test_result_conflict_is_a_lost_lease(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST, "leaseExpiresAt": LEASE}],
        result_status=409,
    )
    client = workbench.client()
    try:
        with pytest.raises(InferenceLeaseLostError):
            run_pass(client, tmp_path, store())
    finally:
        client.close()


def test_pass_does_nothing_when_no_work_is_claimed(tmp_path: Path) -> None:
    workbench = Workbench([])
    client = workbench.client()
    try:
        run_pass(client, tmp_path, store())
    finally:
        client.close()
    assert workbench.calls() == [
        ("POST", "/api/inference/heartbeat"),
        ("POST", "/api/inference/claim"),
    ]


def test_pass_stops_before_starting_another_image(tmp_path: Path) -> None:
    workbench = Workbench(ASSIGNMENTS)
    client = workbench.client()
    stopped = threading.Event()
    stopped.set()
    try:
        run_pass(client, tmp_path, store(), stopped=stopped)
    finally:
        client.close()

    assert workbench.calls() == [
        ("POST", "/api/inference/heartbeat"),
    ]
