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


def test_worker_selects_the_assigned_annotation_runtime(tmp_path, monkeypatch):
    from vitroflow.worker import service
    from vitroflow.worker.annotation import AnnotationClient

    class Runtime:
        def __init__(self, name):
            self.name = name

        def probe(self):
            return {"runtime": self.name, "version": "test", "model": "default"}

    runtimes = {name: Runtime(name) for name in ["pi", "antigravity"]}
    monkeypatch.setattr(worker_session, "available_runtimes", lambda: (TRADITIONAL,))
    monkeypatch.setattr(worker_session, "device_memory_bytes", lambda _: 1)
    assignment = {"runtime": runtimes["antigravity"].probe()}
    monkeypatch.setattr(AnnotationClient, "claim", lambda _: assignment)
    selected = []
    monkeypatch.setattr(
        service,
        "process_annotation_job",
        lambda client, job, directory, runtime, **kwargs: selected.append(runtime),
    )
    worker = Worker(
        WorkerSettings(
            "https://example.test",
            "secret",
            "worker",
            tmp_path,
            annotation_runtimes=runtimes,
        ),
        transport=httpx.MockTransport(Workbench()),
    )
    try:
        assert worker.client.session.heartbeat()["annotationRuntimes"] == [
            runtime.probe() for runtime in runtimes.values()
        ]
        assert worker.serve_once(threading.Event())
        assert selected == [runtimes["antigravity"]]
    finally:
        worker.close()


def test_unavailable_annotation_runtime_does_not_stop_other_capabilities(
    tmp_path, monkeypatch
):
    class Unavailable:
        def probe(self):
            raise ValueError("Not configured")

    monkeypatch.setattr(worker_session, "available_runtimes", lambda: (TRADITIONAL,))
    monkeypatch.setattr(worker_session, "device_memory_bytes", lambda _: 1)
    state = worker_session.WorkerSession.create(
        "worker", None, {"antigravity": Unavailable()}
    )
    assert state.annotation_runtimes == ()
    assert state.runtimes == (TRADITIONAL,)
