from __future__ import annotations

from pathlib import Path

from vitroflow import worker_launchd
from vitroflow.worker_launchd import launch_agent_document, service_label
from vitroflow.worker_profiles import WorkerProfile, save_profile


def test_launch_agent_runs_the_profile_in_foreground(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "mps-trainer",
        WorkerProfile(
            role="training",
            server_url="https://example.test",
            token="secret",
            worker_id="mps-trainer",
            device="mps",
        ),
    )

    document = launch_agent_document("mps-trainer", "/opt/bin/vitroflow")

    assert service_label("mps-trainer") == "com.vitroflow.worker.mps-trainer"
    assert document["ProgramArguments"] == [
        "/opt/bin/vitroflow",
        "worker",
        "run",
        "mps-trainer",
    ]
    assert document["RunAtLoad"] is True
    assert document["KeepAlive"] is True
    assert document["EnvironmentVariables"] == {
        "VITROFLOW_HOME": str(tmp_path),
    }
    assert document["StandardOutPath"] == "/dev/null"


def test_start_kickstarts_an_already_loaded_service(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        worker_launchd, "install_launch_agent", lambda _name: Path("/tmp/worker.plist")
    )
    monkeypatch.setattr(worker_launchd, "service_loaded", lambda _name: True)
    monkeypatch.setattr(worker_launchd.os, "getuid", lambda: 501)
    monkeypatch.setattr(
        worker_launchd, "_launchctl", lambda *arguments: calls.append(arguments)
    )

    worker_launchd.start_service("trainer")

    assert calls == [("kickstart", "gui/501/com.vitroflow.worker.trainer")]


def test_restart_reloads_the_launch_agent(monkeypatch) -> None:
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        worker_launchd, "install_launch_agent", lambda _name: Path("/tmp/worker.plist")
    )
    monkeypatch.setattr(worker_launchd, "service_loaded", lambda _name: True)
    monkeypatch.setattr(worker_launchd.os, "getuid", lambda: 501)
    monkeypatch.setattr(
        worker_launchd, "_launchctl", lambda *arguments: calls.append(arguments)
    )

    worker_launchd.restart_service("trainer")

    assert calls == [
        ("bootout", "gui/501/com.vitroflow.worker.trainer"),
        ("bootstrap", "gui/501", "/tmp/worker.plist"),
    ]
