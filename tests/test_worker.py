from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from vitroflow.config import PipelineConfig
from vitroflow.scoring import DEFAULT_MODEL
from vitroflow.worker import (
    PendingImage,
    WorkerClient,
    WorkerIdentity,
    _health_server,
    run_pass,
)

IDENTITY = WorkerIdentity.create("test-worker", PipelineConfig(), DEFAULT_MODEL)
RESULT = {"source": "images/set/a.jpg", "count": 1, "detections": []}


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


def _count_seeds(image_path, *, source, config, model):
    assert image_path.read_bytes() == b"source"
    return SimpleNamespace(to_dict=lambda: {**RESULT, "source": source})


def _failing_count_seeds(image_path, *, source, config, model):
    raise ValueError("dish not found")


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


def test_worker_identity_reports_a_stable_execution() -> None:
    image = PendingImage("set", "a", "images/set/a.jpg")
    heartbeat = IDENTITY.heartbeat(image)

    assert heartbeat["workerId"] == "test-worker"
    assert heartbeat["current"] == {"dataset": "set", "stem": "a"}
    execution = heartbeat["execution"]
    assert isinstance(execution, dict)
    assert execution["model"] == {
        "name": DEFAULT_MODEL.name,
        "fingerprint": DEFAULT_MODEL.fingerprint,
    }
    assert execution["config"] == PipelineConfig().to_dict()
    assert IDENTITY.heartbeat(None)["current"] is None


def test_pass_prelabels_every_pending_image(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("vitroflow.worker.count_seeds", _count_seeds)
    workbench = Workbench(PENDING)
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PipelineConfig(), DEFAULT_MODEL) is True
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
        "pipeline": IDENTITY.execution.pipeline_fingerprint,
        "model": IDENTITY.execution.model_fingerprint,
    }
    assert json.loads(workbench.requests[2].read()) == IDENTITY.heartbeat(
        PendingImage.from_dict(PENDING[0])
    )
    assert json.loads(workbench.requests[8].read())["current"] is None
    assert workbench.prelabel_bodies() == [
        {**RESULT, "source": "images/set/a.jpg"},
        {**RESULT, "source": "images/set/b.png"},
    ]
    assert list(tmp_path.iterdir()) == []


def test_pass_records_a_failure_document(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("vitroflow.worker.count_seeds", _failing_count_seeds)
    workbench = Workbench(PENDING[:1])
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PipelineConfig(), DEFAULT_MODEL) is True
    finally:
        client.close()

    assert workbench.prelabel_bodies() == [
        {
            "source": "images/set/a.jpg",
            "error": "dish not found",
            **IDENTITY.execution.to_dict(),
        }
    ]


def test_pass_skips_images_that_gained_a_label(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("vitroflow.worker.count_seeds", _count_seeds)
    workbench = Workbench(PENDING, prelabel_status=409)
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PipelineConfig(), DEFAULT_MODEL) is True
    finally:
        client.close()

    assert [call for call in workbench.calls() if call[0] == "PUT"] == [
        ("PUT", "/api/worker/prelabels/set/a"),
        ("PUT", "/api/worker/prelabels/set/b"),
    ]


def test_pass_propagates_http_errors(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("vitroflow.worker.count_seeds", _count_seeds)
    workbench = Workbench(PENDING[:1], prelabel_status=400)
    client = workbench.client()
    try:
        with pytest.raises(httpx.HTTPStatusError):
            run_pass(client, tmp_path, PipelineConfig(), DEFAULT_MODEL)
    finally:
        client.close()


def test_pass_returns_false_when_nothing_is_pending(tmp_path) -> None:
    workbench = Workbench([])
    client = workbench.client()
    try:
        assert run_pass(client, tmp_path, PipelineConfig(), DEFAULT_MODEL) is False
    finally:
        client.close()

    assert workbench.calls() == [
        ("POST", "/api/worker/heartbeat"),
        ("GET", "/api/worker/pending"),
    ]
