from __future__ import annotations

import json

import httpx

from vitroflow import worker_host
from vitroflow.training_worker import TrainingWorkerSettings
from vitroflow.worker_profiles import WorkerProfile, profile_directory, save_profile


def test_training_preflight_checks_authenticated_server_runtime(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    requests: list[httpx.Request] = []

    def ready(url: str, **kwargs: object) -> httpx.Response:
        request = httpx.Request("GET", url, headers=kwargs["headers"])
        requests.append(request)
        return httpx.Response(200, json={"role": "training"}, request=request)

    monkeypatch.setattr(worker_host.httpx, "get", ready)
    monkeypatch.setattr(worker_host.importlib.util, "find_spec", lambda _name: object())
    profile = WorkerProfile(
        role="training",
        server_url="https://example.test",
        token="training-secret",
        worker_id="trainer",
        device="cpu",
    )

    checks = worker_host.preflight_profile("trainer", profile)

    assert requests[0].url.path == "/api/training/ready"
    assert requests[0].headers["authorization"] == "Bearer training-secret"
    assert any(check.startswith("training configs:") for check in checks)


def test_inference_preflight_reports_the_runtimes_it_will_advertise(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    requests: list[httpx.Request] = []

    def ready(url: str, **kwargs: object) -> httpx.Response:
        request = httpx.Request("GET", url, headers=kwargs["headers"])
        requests.append(request)
        return httpx.Response(200, json={"role": "inference"}, request=request)

    monkeypatch.setattr(worker_host.httpx, "get", ready)
    monkeypatch.setattr(worker_host.importlib.util, "find_spec", lambda _name: None)
    profile = WorkerProfile(
        role="inference",
        server_url="https://example.test",
        token="inference-secret",
        worker_id="mac-mps",
    )

    checks = worker_host.preflight_profile("mac-mps", profile)

    assert requests[0].url.path == "/api/inference/ready"
    assert requests[0].headers["authorization"] == "Bearer inference-secret"
    assert "runtimes: traditional" in checks


def test_profile_host_passes_typed_settings_and_marks_readiness(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            role="training",
            server_url="https://example.test",
            token="secret",
            worker_id="trainer",
            device="cpu",
        ),
    )
    received: list[TrainingWorkerSettings] = []

    def run(settings: TrainingWorkerSettings, *, on_ready):
        received.append(settings)
        on_ready()
        return 0

    monkeypatch.setattr(worker_host, "run_training_worker", run)

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
            role="training",
            server_url="https://example.test",
            token="secret",
            worker_id="trainer",
        ),
    )

    def fail(_settings, *, on_ready):
        raise RuntimeError("startup failed")

    monkeypatch.setattr(worker_host, "run_training_worker", fail)

    assert worker_host.run_profile("trainer") == 1

    directory = profile_directory("trainer")
    status = json.loads((directory / "status.json").read_text(encoding="utf-8"))
    assert status["state"] == "failed"
    assert status["detail"] == "startup failed"
    assert "startup failed" in (directory / "worker.log").read_text(encoding="utf-8")
