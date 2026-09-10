from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from vitroflow.worker.host import operations as worker_host
from vitroflow.worker.host.profiles import (
    WorkerProfile,
    profile_directory,
    save_profile,
)
from vitroflow.worker.session import WorkerSettings


def test_preflight_checks_the_authenticated_server_and_runtimes(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    requests: list[httpx.Request] = []

    def ready(url: str, **kwargs: object) -> httpx.Response:
        request = httpx.Request("GET", url, headers=kwargs["headers"])
        requests.append(request)
        return httpx.Response(204, request=request)

    monkeypatch.setattr(worker_host.httpx, "get", ready)
    monkeypatch.setattr(
        worker_host,
        "available_runtimes",
        lambda: (
            SimpleNamespace(adapter="traditional"),
            SimpleNamespace(adapter="ultralytics"),
        ),
    )
    profile = WorkerProfile(
        server_url="https://example.test",
        token="training-secret",
        worker_id="trainer",
        device="cpu",
    )

    checks = worker_host.preflight_profile("trainer", profile)

    assert requests[0].url.path == "/api/worker/ready"
    assert requests[0].headers["authorization"] == "Bearer training-secret"
    assert checks[-2:] == ("runtimes: traditional, ultralytics (cpu)", "device: cpu")


def test_preflight_reports_the_runtimes_it_will_advertise(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    requests: list[httpx.Request] = []

    def ready(url: str, **kwargs: object) -> httpx.Response:
        request = httpx.Request("GET", url, headers=kwargs["headers"])
        requests.append(request)
        return httpx.Response(204, request=request)

    monkeypatch.setattr(worker_host.httpx, "get", ready)
    monkeypatch.setattr(
        worker_host,
        "available_runtimes",
        lambda: (SimpleNamespace(adapter="traditional"),),
    )
    profile = WorkerProfile(
        server_url="https://example.test",
        token="inference-secret",
        worker_id="mac-mps",
    )

    checks = worker_host.preflight_profile("mac-mps", profile)

    assert requests[0].url.path == "/api/worker/ready"
    assert requests[0].headers["authorization"] == "Bearer inference-secret"
    assert "runtimes: traditional" in checks


def test_preflight_surfaces_an_installed_but_broken_runtime(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    monkeypatch.setattr(
        worker_host.httpx,
        "get",
        lambda url, **_kwargs: httpx.Response(204, request=httpx.Request("GET", url)),
    )

    def broken_runtime():
        raise RuntimeError("Ultralytics is installed but cannot be imported")

    monkeypatch.setattr(worker_host, "available_runtimes", broken_runtime)
    profile = WorkerProfile(
        server_url="https://example.test",
        token="inference-secret",
        worker_id="mac-mps",
    )

    with pytest.raises(RuntimeError, match="installed but cannot be imported"):
        worker_host.preflight_profile("mac-mps", profile)


def test_profile_host_passes_typed_settings_and_marks_readiness(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
            worker_id="trainer",
            device="cpu",
        ),
    )
    received: list[WorkerSettings] = []

    def run(settings: WorkerSettings, *, on_ready):
        received.append(settings)
        on_ready()
        return 0

    monkeypatch.setattr(worker_host, "run_worker", run)

    assert worker_host.run_profile("trainer") == 0

    assert len(received) == 1
    assert received[0].server_url == "https://example.test"
    assert received[0].token == "secret"
    status = json.loads(
        (profile_directory("trainer") / "status.json").read_text(encoding="utf-8")
    )
    assert status["state"] == "stopped"


def test_profile_host_records_startup_failures_in_status_and_log(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
            worker_id="trainer",
        ),
    )

    def fail(_settings, *, on_ready):
        raise RuntimeError("startup failed")

    monkeypatch.setattr(worker_host, "run_worker", fail)

    assert worker_host.run_profile("trainer") == 1

    directory = profile_directory("trainer")
    status = json.loads((directory / "status.json").read_text(encoding="utf-8"))
    assert status["state"] == "failed"
    assert status["detail"] == "startup failed"
    assert "startup failed" in (directory / "worker.log").read_text(encoding="utf-8")


def _status_profile(name: str, state: str, **document: object) -> None:
    save_profile(
        name,
        WorkerProfile(
            server_url="https://example.test",
            token="secret",
            worker_id=name,
            device="cpu",
        ),
    )
    (profile_directory(name) / "status.json").write_text(
        json.dumps({"state": state, **document}), encoding="utf-8"
    )


def test_profile_summary_reports_the_failure_detail(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    _status_profile("trainer", "failed", detail="startup failed")
    monkeypatch.setattr(worker_host, "service_loaded", lambda _name: True)

    assert worker_host.profile_summary("trainer").split("\t") == [
        "trainer",
        "failed: startup failed",
        "loaded",
        "cpu",
    ]


def test_profile_summary_reports_a_killed_worker_as_stale(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    _status_profile("trainer", "running")

    monkeypatch.setattr(worker_host, "service_loaded", lambda _name: True)
    assert "\trunning\tloaded\t" in worker_host.profile_summary("trainer")

    monkeypatch.setattr(worker_host, "service_loaded", lambda _name: False)
    assert "\tstale\tnot loaded\t" in worker_host.profile_summary("trainer")
