from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from vitroflow.annotations import BoundingBox
from vitroflow.prelabelers import (
    PrelabelerDescriptor,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
)
from vitroflow.worker import (
    PendingImage,
    WorkerClient,
    WorkerIdentity,
    _health_server,
    run_pass,
)

DESCRIPTOR = PrelabelerDescriptor(
    version_id="traditional-test",
    name="test prelabeler",
    kind="traditional",
    fingerprint="b" * 64,
)


class FakePrelabeler:
    descriptor = DESCRIPTOR

    def predict(self, image_path: Path, source: Path) -> PrelabelResult:
        assert image_path.read_bytes() == b"source"
        return PrelabelResult(
            source=source,
            width=100,
            height=80,
            producer=self.descriptor,
            instances=(PrelabelInstance("1", BoundingBox(10, 20, 8, 6), 0.9),),
            quality=PrelabelQuality("ok"),
        )


class FailingPrelabeler:
    descriptor = DESCRIPTOR

    def predict(self, image_path: Path, source: Path) -> PrelabelResult:
        raise ValueError("dish not found")


PRELABELER = FakePrelabeler()
IDENTITY = WorkerIdentity.create("test-worker", PRELABELER)


class Workbench:
    """A MockTransport workbench recording every request in order."""

    def __init__(
        self, pending: list[dict[str, str]], *, prelabel_status: int = 200
    ) -> None:
        self.pending = pending
        self.prelabel_status = prelabel_status
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["authorization"] == "Bearer secret"
        path = request.url.path
        if path == "/api/worker/heartbeat":
            return httpx.Response(200)
        if path == "/api/worker/pending":
            return httpx.Response(200, json={"images": self.pending})
        if path.startswith("/api/worker/images/"):
            return httpx.Response(200, content=b"source")
        if path.startswith("/api/worker/prelabels/"):
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
    {"dataset": "set", "stem": "a", "source": "images/set/a.jpg"},
    {"dataset": "set", "stem": "b", "source": "images/set/b.png"},
]


def test_health_server_reports_liveness() -> None:
    with _health_server(0) as port:
        response = httpx.get(f"http://127.0.0.1:{port}/healthz")
        missing = httpx.get(f"http://127.0.0.1:{port}/missing")

    assert response.status_code == 200
    assert response.text == "ok\n"
    assert missing.status_code == 404


def test_pending_image_requires_every_field() -> None:
    image = PendingImage.from_dict(PENDING[0])

    assert image == PendingImage("set", "a", "images/set/a.jpg")
    with pytest.raises(ValueError, match="missing source"):
        PendingImage.from_dict({"dataset": "set", "stem": "a"})


def test_worker_identity_reports_its_prelabeler() -> None:
    image = PendingImage("set", "a", "images/set/a.jpg")
    heartbeat = IDENTITY.heartbeat(image)

    assert heartbeat["workerId"] == "test-worker"
    assert heartbeat["current"] == {"dataset": "set", "stem": "a"}
    assert heartbeat["prelabeler"] == DESCRIPTOR.to_dict()
    assert IDENTITY.heartbeat(None)["current"] is None


def test_pass_prelabels_every_pending_image(tmp_path: Path) -> None:
    workbench = Workbench(PENDING)
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PRELABELER) is True
    finally:
        client.close()

    assert workbench.calls() == [
        ("POST", "/api/worker/heartbeat"),
        ("GET", "/api/worker/pending"),
        ("POST", "/api/worker/heartbeat"),
        ("GET", "/api/worker/images/set/a"),
        ("PUT", "/api/worker/prelabels/set/a"),
        ("POST", "/api/worker/heartbeat"),
        ("GET", "/api/worker/images/set/b"),
        ("PUT", "/api/worker/prelabels/set/b"),
        ("POST", "/api/worker/heartbeat"),
    ]
    pending = workbench.requests[1]
    assert dict(pending.url.params) == {
        "version_id": DESCRIPTOR.version_id,
        "fingerprint": DESCRIPTOR.fingerprint,
    }
    assert json.loads(workbench.requests[2].read()) == IDENTITY.heartbeat(
        PendingImage.from_dict(PENDING[0])
    )
    assert json.loads(workbench.requests[8].read())["current"] is None
    assert [body["source"] for body in workbench.prelabel_bodies()] == [
        "images/set/a.jpg",
        "images/set/b.png",
    ]
    assert all(
        body["producer"] == DESCRIPTOR.to_dict() for body in workbench.prelabel_bodies()
    )
    assert all(len(body["instances"]) == 1 for body in workbench.prelabel_bodies())
    assert list(tmp_path.iterdir()) == []


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
            "source": "images/set/a.jpg",
            "producer": DESCRIPTOR.to_dict(),
            "error": "dish not found",
        }
    ]


def test_pass_skips_images_that_gained_a_label(tmp_path: Path) -> None:
    workbench = Workbench(PENDING, prelabel_status=409)
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PRELABELER) is True
    finally:
        client.close()

    assert [call for call in workbench.calls() if call[0] == "PUT"] == [
        ("PUT", "/api/worker/prelabels/set/a"),
        ("PUT", "/api/worker/prelabels/set/b"),
    ]


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
        ("POST", "/api/worker/heartbeat"),
        ("GET", "/api/worker/pending"),
    ]
