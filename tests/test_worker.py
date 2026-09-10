from __future__ import annotations

import threading
from pathlib import Path

import httpx
import pytest

from vitroflow.detectors.contract import RuntimeDescriptor
from vitroflow.worker import session as worker_session
from vitroflow.worker.service import Worker
from vitroflow.worker.session import WorkerSettings

TRADITIONAL = RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64)
ULTRALYTICS = RuntimeDescriptor(adapter="ultralytics", fingerprint="c" * 64)


class Workbench:
    """Answers every claim with nothing and records what was asked."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.url.path)
        if request.url.path == "/api/worker/heartbeat":
            return httpx.Response(200)
        if request.url.path == "/api/worker/training/claim":
            return httpx.Response(200, json={"run": None})
        if request.url.path == "/api/worker/inference/claim":
            return httpx.Response(200, json={"assignment": None})
        return httpx.Response(404)


def _worker(
    tmp_path: Path, monkeypatch, runtimes: tuple[RuntimeDescriptor, ...]
) -> tuple[Worker, Workbench]:
    monkeypatch.setattr(worker_session, "available_runtimes", lambda: runtimes)
    monkeypatch.setattr(worker_session, "device_memory_bytes", lambda _device: 1)
    workbench = Workbench()
    settings = WorkerSettings(
        server_url="https://example.test",
        token="secret",
        worker_id="one",
        work_dir=tmp_path,
    )
    return Worker(settings, transport=httpx.MockTransport(workbench)), workbench


def test_a_worker_that_can_train_asks_for_a_run_before_an_image(
    tmp_path: Path, monkeypatch
) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS))
    try:
        assert served.serve_once(threading.Event()) is False
    finally:
        served.close()
    assert workbench.calls == [
        "/api/worker/heartbeat",
        "/api/worker/training/claim",
        "/api/worker/inference/claim",
    ]


def test_a_worker_without_ultralytics_only_detects(tmp_path: Path, monkeypatch) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL,))
    try:
        assert served.serve_once(threading.Event()) is False
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat", "/api/worker/inference/claim"]


def test_a_stopping_worker_takes_nothing(tmp_path: Path, monkeypatch) -> None:
    served, workbench = _worker(tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS))
    stopped = threading.Event()
    stopped.set()
    try:
        assert served.serve_once(stopped) is False
    finally:
        served.close()
    assert workbench.calls == ["/api/worker/heartbeat"]


def test_training_releases_the_inference_model_and_its_own_allocations(
    tmp_path: Path, monkeypatch
) -> None:
    from vitroflow.worker import service as worker

    served, _ = _worker(tmp_path, monkeypatch, (TRADITIONAL, ULTRALYTICS))
    events: list[str] = []
    jobs = iter([None, object(), object()])
    monkeypatch.setattr(served.training, "claim", lambda: next(jobs))
    monkeypatch.setattr(served.store, "unload", lambda: events.append("unload"))
    monkeypatch.setattr(
        worker, "run_pass", lambda *args, **kwargs: events.append("inference") or True
    )
    monkeypatch.setattr(worker, "release_accelerator", lambda: events.append("release"))

    def train(*args, **kwargs):
        assert events[-1] == "unload"
        events.append("training")

    monkeypatch.setattr(worker, "process_training_job", train)
    try:
        assert served.serve_once(threading.Event()) is True
        assert served.serve_once(threading.Event()) is True
        assert events == ["inference", "unload", "training", "release"]

        def fail(*args, **kwargs):
            raise RuntimeError("training failed")

        monkeypatch.setattr(worker, "process_training_job", fail)
        with pytest.raises(RuntimeError, match="training failed"):
            served.serve_once(threading.Event())
        assert events[-2:] == ["unload", "release"]
    finally:
        served.close()
