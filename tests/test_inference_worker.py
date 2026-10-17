from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx
import pytest

from vitroctl.annotations import BoundingBox
from vitroctl.detectors.contract import (
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    RuntimeDescriptor,
)
from vitroctl.worker import session as worker_session
from vitroctl.worker.images import ImageCache
from vitroctl.worker.inference import (
    LOOKAHEAD,
    Assignment,
    InferenceClient,
    InferencePipeline,
)
from vitroctl.worker.model_store import ModelManifest, ModelStore
from vitroctl.worker.session import LeaseLostError, WorkerClient, WorkerSession

RUNTIME = RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64)
IMAGE = b"source"
DIGEST = hashlib.sha256(IMAGE).hexdigest()
MANIFEST = {
    "schemaVersion": 1,
    "modelVersionId": "set.traditional-v1",
    "classes": ["ungerminated", "germinated"],
    "artifact": {"kind": "traditional", "digest": "a" * 64},
}
OTHER_MANIFEST = {
    "schemaVersion": 1,
    "modelVersionId": "set.traditional-v2",
    "classes": ["ungerminated", "germinated"],
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
            (DetectionInstance("1", "ungerminated", BoundingBox(10, 20, 8, 6), 0.9),),
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
SESSION = WorkerSession("test-session", "2026-08-27T00:00:00+00:00", (RUNTIME,), 8_192)
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
        images: dict[str, bytes] | None = None,
    ) -> None:
        self.assignments = list(assignments)
        self.result_status = result_status
        self.lease_status = lease_status
        self.lease_statuses = list(lease_statuses or [])
        self.images = {DIGEST: IMAGE, **(images or {})}
        self.requests: list[httpx.Request] = []
        self.downloaded: defaultdict[str, threading.Event] = defaultdict(
            threading.Event
        )

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
            if request.method == "DELETE":
                return httpx.Response(204)
            status = (
                self.lease_statuses.pop(0) if self.lease_statuses else self.lease_status
            )
            return httpx.Response(status, json={})
        if path.startswith("/api/worker/inference/images/"):
            digest = path.rsplit("/", 1)[1]
            self.downloaded[digest].set()
            return httpx.Response(200, content=self.images[digest])
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


def run_once(
    client: InferenceClient,
    work_dir: Path,
    models: Any,
    stopped: threading.Event | None = None,
) -> bool:
    images = ImageCache(work_dir / "images")
    pipeline = InferencePipeline(client, models, images)
    try:
        return pipeline.run_once(stopped)
    finally:
        pipeline.close()
        images.close()


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
                    "classes": ["ungerminated", "germinated"],
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
                    "classes": ["ungerminated", "germinated"],
                    "artifact": {"kind": "traditional", "digest": "a" * 64},
                },
                "image": DIGEST,
            }
        )


def test_heartbeat_describes_what_the_session_can_do() -> None:
    assert SESSION.heartbeat() == {
        "sessionId": "test-session",
        "startedAt": "2026-08-27T00:00:00+00:00",
        "runtimes": [RUNTIME.to_dict()],
        "memoryBytes": 8_192,
    }


def test_a_claimed_image_is_detected_and_reported(tmp_path: Path) -> None:
    workbench = Workbench(ASSIGNMENTS)
    client = workbench.client()
    models = store()
    try:
        assert run_once(client, tmp_path, models) is True
    finally:
        client.worker.close()

    calls = workbench.calls()
    # The image downloads beside the claim for the next task, so only the
    # protocol's own order is fixed: claim, then lease, and the result last.
    assert calls[:2] == [
        ("POST", "/api/worker/inference/claim"),
        (
            "POST",
            f"/api/worker/inference/claims/set.traditional-v1/{DIGEST}/lease",
        ),
    ]
    assert sorted(calls[2:4]) == [
        ("GET", f"/api/worker/inference/images/{DIGEST}"),
        ("POST", "/api/worker/inference/claim"),
    ]
    assert calls[4:] == [
        ("PUT", f"/api/worker/inference/results/set.traditional-v1/{DIGEST}"),
    ]
    assert models.loads == ["set.traditional-v1"]
    assert json.loads(workbench.requests[0].read()) == {
        "sessionId": "test-session",
    }
    assert json.loads(workbench.requests[1].read()) == {
        "sessionId": "test-session",
    }
    assert dict(workbench.requests[-1].url.params) == {
        "sessionId": "test-session",
    }
    for body in workbench.result_bodies():
        assert body["schemaVersion"] == 1
        assert body["image"] == {"digest": DIGEST, "width": 100, "height": 80}
        assert body["producer"] == PRODUCER.to_dict()


def test_a_version_that_cannot_load_is_skipped(tmp_path: Path) -> None:
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
    images = ImageCache(tmp_path / "images")
    pipeline = InferencePipeline(client, models, images)  # type: ignore[arg-type]
    try:
        assert pipeline.run_once() is True
        assert pipeline.run_once() is True
        assert pipeline.run_once() is False
    finally:
        pipeline.close()
        images.close()
        client.worker.close()
    assert models.loads == ["set.traditional-v2", "set.traditional-v1"]
    assert [body["producer"] for body in workbench.result_bodies()] == [
        PRODUCER.to_dict()
    ]


def test_the_next_image_downloads_while_this_one_is_detected(
    tmp_path: Path,
) -> None:
    second = b"second source"
    second_digest = hashlib.sha256(second).hexdigest()
    workbench = Workbench(
        [
            {"manifest": MANIFEST, "image": DIGEST},
            {"manifest": MANIFEST, "image": second_digest},
        ],
        images={second_digest: second},
    )
    overlapped: list[bool] = []

    class WaitingDetector(FakeDetector):
        def predict(
            self, image_path: Path, digest: str, producer: DetectionProducer
        ) -> DetectionResult:
            if digest == DIGEST:
                overlapped.append(workbench.downloaded[second_digest].wait(timeout=5))
            return DetectionResult(
                digest, 100, 80, producer, (), DetectionQuality("ok")
            )

    client = workbench.client()
    images = ImageCache(tmp_path / "images")
    pipeline = InferencePipeline(client, store(WaitingDetector()), images)  # type: ignore[arg-type]
    try:
        assert pipeline.run_once() is True
        assert overlapped == [True]
        assert pipeline.run_once() is True
    finally:
        pipeline.close()
        images.close()
        client.worker.close()
    assert [body["image"]["digest"] for body in workbench.result_bodies()] == [
        DIGEST,
        second_digest,
    ]


def test_an_image_read_by_one_version_is_not_fetched_for_the_next(
    tmp_path: Path,
) -> None:
    other = FakeDetector()
    other.artifact_digest = "c" * 64
    workbench = Workbench(
        [
            {"manifest": MANIFEST, "image": DIGEST},
            {"manifest": OTHER_MANIFEST, "image": DIGEST},
        ]
    )
    client = workbench.client()
    models = FakeStore({"set.traditional-v1": DETECTOR, "set.traditional-v2": other})
    try:
        run_once(client, tmp_path, models)
        workbench.assignments.append({"manifest": OTHER_MANIFEST, "image": DIGEST})
        run_once(client, tmp_path, models)
    finally:
        client.worker.close()
    fetches = [call for call in workbench.calls() if call[0] == "GET"]
    assert fetches == [("GET", f"/api/worker/inference/images/{DIGEST}")]
    assert len(workbench.result_bodies()) == 2


def test_the_tasks_taken_ahead_are_released(tmp_path: Path) -> None:
    others = {hashlib.sha256(bytes([n])).hexdigest(): bytes([n]) for n in range(4)}
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": digest} for digest in [DIGEST, *others]],
        images=others,
    )
    client = workbench.client()
    try:
        run_once(client, tmp_path, store())
    finally:
        client.worker.close()
    released = [
        path.removesuffix("/lease").rsplit("/", 1)[1]
        for method, path in workbench.calls()
        if method == "DELETE"
    ]
    assert released == list(others)[:LOOKAHEAD]
    assert len(workbench.assignments) == len(others) - LOOKAHEAD
    assert [body["image"]["digest"] for body in workbench.result_bodies()] == [DIGEST]


def test_an_image_that_fails_digest_verification_is_refused(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST}],
        images={DIGEST: b"tampered"},
    )
    client = workbench.client()
    try:
        with pytest.raises(ValueError, match="digest verification"):
            run_once(client, tmp_path, store())
    finally:
        client.worker.close()
    assert workbench.result_bodies() == []


def test_a_detection_failure_is_recorded(tmp_path: Path) -> None:
    workbench = Workbench([{"manifest": MANIFEST, "image": DIGEST}])
    client = workbench.client()
    try:
        run_once(client, tmp_path, store(FailingDetector()))
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
def test_a_refused_result_surfaces(tmp_path: Path, status: int) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST}],
        result_status=status,
    )
    client = workbench.client()
    try:
        with pytest.raises(httpx.HTTPStatusError):
            run_once(client, tmp_path, store())
    finally:
        client.worker.close()


def test_a_lost_lease_surfaces(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"manifest": MANIFEST, "image": DIGEST}],
        lease_status=409,
    )
    client = workbench.client()
    try:
        with pytest.raises(LeaseLostError):
            run_once(client, tmp_path, store())
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
            run_once(client, tmp_path, store(SlowDetector()))
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
            run_once(client, tmp_path, store())
    finally:
        client.worker.close()


def test_nothing_happens_when_no_work_is_claimed(tmp_path: Path) -> None:
    workbench = Workbench([])
    client = workbench.client()
    try:
        run_once(client, tmp_path, store())
    finally:
        client.worker.close()
    assert workbench.calls() == [("POST", "/api/worker/inference/claim")]


def test_a_stopping_worker_starts_no_image(tmp_path: Path) -> None:
    workbench = Workbench(ASSIGNMENTS)
    client = workbench.client()
    stopped = threading.Event()
    stopped.set()
    try:
        run_once(client, tmp_path, store(), stopped)
    finally:
        client.worker.close()

    assert workbench.calls() == []


def test_traditional_detector_requires_its_class(tmp_path: Path) -> None:
    class NoWeights:
        def weights(self, version_id: str) -> bytes:
            raise AssertionError(version_id)

    store = ModelStore(NoWeights(), tmp_path, None)
    manifest = ModelManifest.parse({**MANIFEST, "classes": ["germinated"]})

    with pytest.raises(ValueError, match="declares ungerminated"):
        store.load(manifest)
