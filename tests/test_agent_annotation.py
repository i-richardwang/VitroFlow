from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import cv2
import httpx
import numpy as np
import pytest

from vitroflow.agent_annotation.runner import run_annotation
from vitroflow.agent_runtimes.pi import AgentInterruptedError, PiRuntime
from vitroflow.autoannotation.storage import read_json
from vitroflow.worker import connection
from vitroflow.worker.annotation import AnnotationClient, process_annotation_job
from vitroflow.worker.session import LeaseLostError, WorkerClient, WorkerSession


@pytest.fixture
def pi(tmp_path):
    fixture = Path(__file__).parent / "fixtures" / "pi_runtime.py"
    executable = tmp_path / "pi fixture"
    executable.write_text(f"#!{sys.executable}\n" + fixture.read_text())
    executable.chmod(0o700)
    return str(executable)


@pytest.fixture
def photo(tmp_path):
    path = tmp_path / "image.png"
    cv2.imwrite(str(path), np.full((80, 160, 3), 128, np.uint8))
    return path


def test_supervised_collection_and_private_environment(
    pi, photo, tmp_path, monkeypatch
):
    monkeypatch.setenv("VITROFLOW_WORKER_TOKEN", "must-not-inherit")
    progress = []
    report = run_annotation(
        photo,
        tmp_path / "run",
        PiRuntime("test/vision", pi),
        config={"coreSize": 64, "halo": 16},
        progress=lambda done, total: progress.append((done, total)),
    )
    result = read_json(tmp_path / "run/result/result.json")
    assert result["coverage"]["fullImage"]
    assert result["image"]["width"] == 160
    assert len(result["checkpointDigests"]) == 6
    assert progress[0] == (0, 6) and progress[-1] == (6, 6)
    assert report["execution"]["messages"][0]["usage"] == {"input": 2, "output": 3}
    assert read_json(tmp_path / "run/runtime/environment.json") == {}
    arguments = json.loads((tmp_path / "run/runtime/arguments.json").read_text())
    assert arguments[arguments.index("--model") + 1] == "test/vision"
    assert "--no-extensions" in arguments and "--no-context-files" in arguments
    assert (
        arguments[arguments.index("--tools") + 1]
        == "annotation_view,annotation_preview,annotation_submit"
    )
    assert "--extension" in arguments
    with pytest.raises(FileExistsError):
        run_annotation(photo, tmp_path / "run", PiRuntime("test/vision", pi))


@pytest.mark.parametrize(
    ("model", "message"),
    [
        ("test/no-vision", "does not support image"),
        ("test/error", "assistant error"),
        ("test/invalid-stream", "Invalid Pi JSON"),
        ("test/incomplete", "complete"),
    ],
)
def test_errors_never_export_success(pi, photo, tmp_path, model, message):
    with pytest.raises((ValueError, RuntimeError), match=message):
        run_annotation(photo, tmp_path / "run", PiRuntime(model, pi))
    assert not (tmp_path / "run/result/result.json").exists()
    assert read_json(tmp_path / "run/status.json")["status"] == "failed"


def test_timeout_and_cancellation_terminate_pi(pi, tmp_path):
    for name, timeout, cancel, exception in [
        ("timeout", 2, lambda: False, RuntimeError),
        (
            "cancel",
            30,
            lambda: (tmp_path / "cancel/pid").exists(),
            AgentInterruptedError,
        ),
    ]:
        directory = tmp_path / name
        with pytest.raises(exception):
            PiRuntime("test/wait", pi, timeout).execute(
                "unused",
                directory,
                descriptor={"runtime": "pi", "version": "test", "model": "test/wait"},
                cancelled=cancel,
            )
        pid = int((directory / "pid").read_text())
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)


@pytest.mark.parametrize(
    "transport_failure",
    [None, "timeout", "server-error", "lease-lost", "delivery-timeout"],
)
def test_worker_downloads_exact_bytes_freezes_input_and_uploads_result(
    pi, photo, tmp_path, monkeypatch, transport_failure
):
    backoffs = []
    monkeypatch.setattr(connection, "time", SimpleNamespace(sleep=backoffs.append))
    content = photo.read_bytes()
    assignment = {
        "id": "ai-run",
        "image": {
            "digest": hashlib.sha256(content).hexdigest(),
            "width": 160,
            "height": 80,
        },
        "input": [],
        "config": {
            "classes": ["seed"],
            "rules": "Annotate seeds",
            "coreSize": 512,
            "halo": 32,
            "displayScale": 2,
        },
        "runtime": {"runtime": "pi", "version": "test-version", "model": "test/vision"},
    }
    probes = []
    original_probe = PiRuntime.probe

    def probe(runtime):
        probes.append(runtime)
        return original_probe(runtime)

    monkeypatch.setattr(PiRuntime, "probe", probe)
    updates = []
    delivery_available = False

    def respond(request):
        assert request.headers["Authorization"] == "Bearer worker-token"
        if request.method == "GET":
            return httpx.Response(200, content=content)
        if request.url.path.endswith("claim"):
            return httpx.Response(200, json={"run": assignment})
        update = json.loads(request.content)
        updates.append(update)
        if (
            update["operation"] == "complete"
            and transport_failure == "delivery-timeout"
            and not delivery_available
        ):
            raise httpx.ReadTimeout("Delivery unavailable", request=request)
        if update["operation"] == "progress":
            if transport_failure == "timeout":
                raise httpx.ReadTimeout("Temporary progress timeout", request=request)
            if transport_failure == "server-error":
                return httpx.Response(503)
            if transport_failure == "lease-lost":
                return httpx.Response(409)
        return httpx.Response(200, json={"ok": True})

    worker = WorkerClient(
        "https://workbench.test",
        "worker-token",
        WorkerSession("worker", "session", "2026-09-14T00:00:00Z", (), 1024),
        transport=httpx.MockTransport(respond),
    )
    client = AnnotationClient(worker)
    try:
        claimed = client.claim()
        assert claimed == assignment
        if transport_failure == "lease-lost":
            with pytest.raises(LeaseLostError):
                process_annotation_job(
                    client,
                    claimed,
                    tmp_path / "work",
                    PiRuntime("test/vision", pi),
                    stopped=threading.Event(),
                )
            assert not any(update["operation"] == "complete" for update in updates)
            assert backoffs == []
            return
        if transport_failure == "delivery-timeout":
            with pytest.raises(httpx.ReadTimeout):
                process_annotation_job(
                    client,
                    claimed,
                    tmp_path / "work",
                    PiRuntime("test/vision", pi),
                    stopped=threading.Event(),
                )
            assert not any(update["operation"] == "fail" for update in updates)
            assert (tmp_path / "work/annotations/ai-run/product-result.json").is_file()
            delivery_available = True
        process_annotation_job(
            client,
            claimed,
            tmp_path / "work",
            PiRuntime("test/vision", pi),
            stopped=threading.Event(),
        )
    finally:
        worker.close()
    assert len(probes) == 1
    completed = updates[-1]
    assert completed["operation"] == "complete"
    assert "messages" not in completed["result"]["execution"]
    execution = read_json(tmp_path / "work/annotations/ai-run/execution/execution.json")
    assert execution["messages"][0]["usage"] == {"input": 2, "output": 3}
    assert completed["result"]["document"]["image"] == assignment["image"]
    assert completed["result"]["document"]["instances"] == []
    assert completed["workerId"] == "worker"
    reported = [
        value["progress"]["completed"]
        for value in updates
        if value["operation"] == "progress"
    ]
    assert reported[0] == 0 and reported[-1] == 1
    assert reported == sorted(reported)
    if transport_failure in ("timeout", "server-error"):
        assert backoffs == [0.5, 1.0] * (len(reported) // 3)
    elif transport_failure == "delivery-timeout":
        assert backoffs == [0.5, 1.0]
    else:
        assert backoffs == []


def test_pi_default_model_is_resolved_before_execution(pi):
    descriptor = PiRuntime(executable=pi).probe()
    assert descriptor == {
        "runtime": "pi",
        "version": "test-version",
        "model": "test/vision",
    }


def test_runtime_change_refuses_execution(pi, photo, tmp_path):
    with pytest.raises(ValueError, match="differs from assignment"):
        run_annotation(
            photo,
            tmp_path / "run",
            PiRuntime("test/vision", pi),
            expected_runtime={
                "runtime": "pi",
                "version": "previous",
                "model": "test/vision",
            },
        )
    assert not (tmp_path / "run/runtime").exists()
    assert read_json(tmp_path / "run/status.json")["status"] == "failed"


def test_failed_pi_version_probe_is_an_execution_failure(photo, tmp_path):
    executable = tmp_path / "broken-pi"
    executable.write_text(f"#!{sys.executable}\nraise SystemExit(2)\n")
    executable.chmod(0o700)
    with pytest.raises(RuntimeError, match="version probe failed"):
        run_annotation(photo, tmp_path / "run", PiRuntime(executable=str(executable)))
    assert read_json(tmp_path / "run/status.json")["status"] == "failed"
