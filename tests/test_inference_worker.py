from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any

import httpx
import pytest

from vitroflow.annotations import BoundingBox
from vitroflow.inference_worker import (
    Assignment,
    PendingImage,
    WorkerClient,
    WorkerRuntime,
    run_pass,
)
from vitroflow.prelabelers import (
    PredictionProducer,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
    RuntimeDescriptor,
)

RUNTIME = RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64)
IMAGE = b"source"
DIGEST = hashlib.sha256(IMAGE).hexdigest()
VERSION = {
    "id": "set.traditional-v1",
    "artifact": {"kind": "traditional", "digest": "a" * 64},
}
OTHER_VERSION = {
    "id": "set.yolo-v2",
    "artifact": {"kind": "ultralytics", "digest": "c" * 64},
}


class FakePrelabeler:
    artifact_digest = "a" * 64
    runtime = RUNTIME

    def predict(
        self, image_path: Path, digest: str, producer: PredictionProducer
    ) -> PrelabelResult:
        assert image_path.read_bytes() == IMAGE
        assert image_path.name == f"{digest}{image_path.suffix}"
        return PrelabelResult(
            digest,
            100,
            80,
            producer,
            (PrelabelInstance("1", BoundingBox(10, 20, 8, 6), 0.9),),
            PrelabelQuality("ok"),
        )


class FailingPrelabeler(FakePrelabeler):
    def predict(
        self, image_path: Path, digest: str, producer: PredictionProducer
    ) -> PrelabelResult:
        raise ValueError("dish not found")


class FakeStore:
    """Serves one prelabeler per version id and refuses the others."""

    def __init__(self, prelabelers: dict[str, Any]) -> None:
        self.prelabelers = prelabelers
        self.loaded: str | None = None
        self.loads: list[str] = []

    def load(self, manifest: dict[str, Any]) -> Any:
        version_id = manifest["id"]
        self.loads.append(version_id)
        if version_id not in self.prelabelers:
            raise RuntimeError(f"no weights for {version_id}")
        self.loaded = version_id
        return self.prelabelers[version_id]


PRELABELER = FakePrelabeler()
WORKER = WorkerRuntime("test-worker", "2026-08-27T00:00:00+00:00", (RUNTIME,))
PRODUCER = PredictionProducer("set.traditional-v1", "a" * 64, RUNTIME)


def store(prelabeler: Any = PRELABELER) -> FakeStore:
    return FakeStore({"set.traditional-v1": prelabeler})


class Workbench:
    def __init__(
        self,
        assignments: list[dict[str, Any]],
        *,
        prelabel_status: int = 200,
        image: bytes = IMAGE,
    ) -> None:
        self.assignments = assignments
        self.prelabel_status = prelabel_status
        self.image = image
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["authorization"] == "Bearer secret"
        path = request.url.path
        if path == "/api/inference/heartbeat":
            return httpx.Response(200)
        if path == "/api/inference/pending":
            return httpx.Response(200, json={"assignments": self.assignments})
        if path.startswith("/api/inference/images/"):
            return httpx.Response(200, content=self.image)
        if path.startswith("/api/inference/prelabels/"):
            return httpx.Response(self.prelabel_status, json={})
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

    def prelabel_bodies(self) -> list[dict[str, object]]:
        return [
            json.loads(request.read())
            for request in self.requests
            if request.method == "PUT"
        ]


PENDING = [
    {"dataset": "set", "digest": DIGEST, "extension": ".jpg"},
    {"dataset": "set", "digest": DIGEST, "extension": ".png"},
]
ASSIGNMENTS = [{"modelVersion": VERSION, "images": PENDING}]


def test_pending_image_requires_every_field() -> None:
    assert PendingImage.parse(PENDING[0]) == PendingImage("set", DIGEST, ".jpg")
    with pytest.raises(ValueError, match="missing extension"):
        PendingImage.parse({"dataset": "set", "digest": DIGEST})
    with pytest.raises(ValueError, match="digest must be a SHA-256"):
        PendingImage.parse(
            {"dataset": "set", "digest": "images/set/a.jpg", "extension": ".jpg"}
        )
    with pytest.raises(ValueError, match="extension must be one of"):
        PendingImage.parse({"dataset": "set", "digest": DIGEST, "extension": ".gif"})


def test_assignment_validates_its_model_version() -> None:
    assignment = Assignment.parse(ASSIGNMENTS[0])
    assert assignment.version_id == "set.traditional-v1"
    assert len(assignment.images) == 2
    with pytest.raises(ValueError, match="kind is unsupported"):
        Assignment.parse(
            {
                "modelVersion": {
                    "id": "set.v1",
                    "artifact": {"kind": "onnx", "digest": "a" * 64},
                },
                "images": [],
            }
        )
    with pytest.raises(ValueError, match="id is invalid"):
        Assignment.parse(
            {
                "modelVersion": {
                    "id": "/set",
                    "artifact": {"kind": "traditional", "digest": "a" * 64},
                },
                "images": [],
            }
        )


def test_heartbeat_describes_runtimes_and_loaded_version() -> None:
    heartbeat = WORKER.heartbeat(
        "set.traditional-v1", PendingImage("set", DIGEST, ".jpg")
    )
    assert heartbeat == {
        "workerId": "test-worker",
        "startedAt": "2026-08-27T00:00:00+00:00",
        "runtimes": [RUNTIME.to_dict()],
        "loaded": "set.traditional-v1",
        "current": {"dataset": "set", "digest": DIGEST},
    }
    assert WORKER.heartbeat(None, None)["loaded"] is None


def test_pass_prelabels_every_assigned_image(tmp_path: Path) -> None:
    workbench = Workbench(ASSIGNMENTS)
    client = workbench.client()
    models = store()
    try:
        assert run_pass(client, tmp_path, models) is True
    finally:
        client.close()

    assert workbench.calls() == [
        ("POST", "/api/inference/heartbeat"),
        ("GET", "/api/inference/pending"),
        ("POST", "/api/inference/heartbeat"),
        ("GET", f"/api/inference/images/{DIGEST}"),
        ("PUT", f"/api/inference/prelabels/set/{DIGEST}"),
        ("POST", "/api/inference/heartbeat"),
        ("GET", f"/api/inference/images/{DIGEST}"),
        ("PUT", f"/api/inference/prelabels/set/{DIGEST}"),
        ("POST", "/api/inference/heartbeat"),
    ]
    assert models.loads == ["set.traditional-v1"]
    assert [beat["loaded"] for beat in workbench.heartbeats()] == [
        None,
        "set.traditional-v1",
        "set.traditional-v1",
        "set.traditional-v1",
    ]
    assert dict(workbench.requests[1].url.params) == {"workerId": "test-worker"}
    assert dict(workbench.requests[4].url.params) == {"workerId": "test-worker"}
    for body in workbench.prelabel_bodies():
        assert body["schema_version"] == 1
        assert body["image"] == {"digest": DIGEST, "width": 100, "height": 80}
        assert body["producer"] == PRODUCER.to_dict()
    assert list(tmp_path.iterdir()) == []


def test_pass_skips_versions_it_cannot_load(tmp_path: Path) -> None:
    workbench = Workbench(
        [
            {"modelVersion": OTHER_VERSION, "images": PENDING[:1]},
            {"modelVersion": VERSION, "images": PENDING[:1]},
        ]
    )
    client = workbench.client()
    models = store()
    try:
        assert run_pass(client, tmp_path, models) is True
    finally:
        client.close()
    assert models.loads == ["set.yolo-v2", "set.traditional-v1"]
    assert [body["producer"] for body in workbench.prelabel_bodies()] == [
        PRODUCER.to_dict()
    ]


def test_pass_rejects_images_that_fail_digest_verification(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"modelVersion": VERSION, "images": PENDING[:1]}], image=b"tampered"
    )
    client = workbench.client()
    try:
        with pytest.raises(ValueError, match="digest verification"):
            run_pass(client, tmp_path, store())
    finally:
        client.close()
    assert workbench.prelabel_bodies() == []


def test_pass_records_a_failure_document(tmp_path: Path) -> None:
    workbench = Workbench([{"modelVersion": VERSION, "images": PENDING[:1]}])
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, store(FailingPrelabeler())) is True
    finally:
        client.close()
    assert workbench.prelabel_bodies() == [
        {
            "schema_version": 1,
            "image": {"digest": DIGEST},
            "producer": PRODUCER.to_dict(),
            "error": "dish not found",
        }
    ]


@pytest.mark.parametrize("status", [200, 409])
def test_pass_accepts_stored_or_superseded_results(tmp_path: Path, status: int) -> None:
    workbench = Workbench(
        [{"modelVersion": VERSION, "images": PENDING[:1]}], prelabel_status=status
    )
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, store()) is True
    finally:
        client.close()


def test_pass_propagates_http_errors(tmp_path: Path) -> None:
    workbench = Workbench(
        [{"modelVersion": VERSION, "images": PENDING[:1]}], prelabel_status=400
    )
    client = workbench.client()
    try:
        with pytest.raises(httpx.HTTPStatusError):
            run_pass(client, tmp_path, store())
    finally:
        client.close()


def test_pass_returns_false_when_nothing_is_pending(tmp_path: Path) -> None:
    workbench = Workbench([])
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, store()) is False
    finally:
        client.close()
    assert workbench.calls() == [
        ("POST", "/api/inference/heartbeat"),
        ("GET", "/api/inference/pending"),
    ]


def test_pass_stops_before_starting_another_image(tmp_path: Path) -> None:
    workbench = Workbench(ASSIGNMENTS)
    client = workbench.client()
    stopped = threading.Event()
    stopped.set()
    try:
        assert run_pass(client, tmp_path, store(), stopped=stopped) is True
    finally:
        client.close()

    assert workbench.calls() == [
        ("POST", "/api/inference/heartbeat"),
        ("GET", "/api/inference/pending"),
        ("POST", "/api/inference/heartbeat"),
    ]
