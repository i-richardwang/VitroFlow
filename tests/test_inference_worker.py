from __future__ import annotations

import hashlib
import json
from pathlib import Path

import httpx
import pytest

from vitroflow.annotations import BoundingBox
from vitroflow.inference_worker import (
    PendingImage,
    WorkerClient,
    WorkerIdentity,
    run_pass,
)
from vitroflow.prelabelers import (
    PredictionProducer,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
    RuntimeDescriptor,
)
from vitroflow.worker_runtime import health_server

RUNTIME = RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64)
IMAGE = b"source"
DIGEST = hashlib.sha256(IMAGE).hexdigest()
OTHER = hashlib.sha256(b"other").hexdigest()


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


PRELABELER = FakePrelabeler()
IDENTITY = WorkerIdentity.create("test-worker", "set.traditional-v1", PRELABELER)


class Workbench:
    def __init__(
        self,
        pending: list[dict[str, str]],
        *,
        prelabel_status: int = 200,
        image: bytes = IMAGE,
    ) -> None:
        self.pending = pending
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
            return httpx.Response(200, json={"images": self.pending})
        if path.startswith("/api/inference/images/"):
            return httpx.Response(200, content=self.image)
        if path.startswith("/api/inference/prelabels/"):
            return httpx.Response(self.prelabel_status, json={})
        return httpx.Response(404)

    def client(self) -> WorkerClient:
        return WorkerClient(
            "https://example.test",
            "secret",
            IDENTITY,
            transport=httpx.MockTransport(self),
        )

    def calls(self) -> list[tuple[str, str]]:
        return [(request.method, request.url.path) for request in self.requests]

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


def test_health_server_reports_liveness() -> None:
    with health_server(0) as port:
        response = httpx.get(f"http://127.0.0.1:{port}/healthz")
        missing = httpx.get(f"http://127.0.0.1:{port}/missing")
    assert response.status_code == 200
    assert response.text == "ok\n"
    assert missing.status_code == 404


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


def test_worker_identity_separates_deployment_and_runtime() -> None:
    heartbeat = IDENTITY.heartbeat(PendingImage("set", DIGEST, ".jpg"))
    assert heartbeat["deployment"] == {
        "modelVersionId": "set.traditional-v1",
        "artifactDigest": "a" * 64,
    }
    assert heartbeat["runtime"] == RUNTIME.to_dict()
    assert heartbeat["current"] == {"dataset": "set", "digest": DIGEST}


def test_pass_prelabels_every_pending_image(tmp_path: Path) -> None:
    workbench = Workbench(PENDING)
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PRELABELER) is True
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
    assert dict(workbench.requests[1].url.params) == {"workerId": "test-worker"}
    assert dict(workbench.requests[4].url.params) == {"workerId": "test-worker"}
    for body in workbench.prelabel_bodies():
        assert body["schema_version"] == 1
        assert body["image"] == {"digest": DIGEST, "width": 100, "height": 80}
        assert body["producer"] == IDENTITY.producer.to_dict()
    assert list(tmp_path.iterdir()) == []


def test_pass_rejects_images_that_fail_digest_verification(tmp_path: Path) -> None:
    workbench = Workbench(PENDING[:1], image=b"tampered")
    client = workbench.client()
    try:
        with pytest.raises(ValueError, match="digest verification"):
            run_pass(client, tmp_path, PRELABELER)
    finally:
        client.close()
    assert workbench.prelabel_bodies() == []


def test_pass_records_a_failure_document(tmp_path: Path) -> None:
    workbench = Workbench(PENDING[:1])
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, FailingPrelabeler()) is True
    finally:
        client.close()
    assert workbench.prelabel_bodies() == [
        {
            "schema_version": 1,
            "image": {"digest": DIGEST},
            "producer": IDENTITY.producer.to_dict(),
            "error": "dish not found",
        }
    ]


@pytest.mark.parametrize("status", [200, 409])
def test_pass_accepts_stored_or_superseded_results(tmp_path: Path, status: int) -> None:
    workbench = Workbench(PENDING[:1], prelabel_status=status)
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PRELABELER) is True
    finally:
        client.close()


def test_pass_propagates_http_errors(tmp_path: Path) -> None:
    workbench = Workbench(PENDING[:1], prelabel_status=400)
    client = workbench.client()
    try:
        with pytest.raises(httpx.HTTPStatusError):
            run_pass(client, tmp_path, PRELABELER)
    finally:
        client.close()


def test_pass_returns_false_when_nothing_is_pending(tmp_path: Path) -> None:
    workbench = Workbench([])
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PRELABELER) is False
    finally:
        client.close()
    assert workbench.calls() == [
        ("POST", "/api/inference/heartbeat"),
        ("GET", "/api/inference/pending"),
    ]
