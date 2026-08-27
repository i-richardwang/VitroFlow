from __future__ import annotations

import pytest

from vitroflow import worker_command
from vitroflow.cli import main
from vitroflow.worker_profiles import WorkerProfile, load_profile, save_profile


def _mock_setup(monkeypatch, *, token: str = "secret") -> list[str]:
    started: list[str] = []
    monkeypatch.setattr(worker_command, "require_launchd", lambda: None)
    monkeypatch.setattr(worker_command.getpass, "getpass", lambda _prompt: token)
    monkeypatch.setattr(
        worker_command,
        "preflight_profile",
        lambda name, profile: (f"profile: {name} ({profile.role})",),
    )
    monkeypatch.setattr(worker_command, "start_service", started.append)
    return started


def test_setup_preflights_saves_and_starts_without_exposing_token(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    started = _mock_setup(monkeypatch)

    result = main(
        [
            "worker",
            "setup",
            "training",
            "mac-mps",
            "--server",
            "https://example.test",
            "--device",
            "mps",
        ]
    )

    assert result == 0
    assert load_profile("mac-mps").token == "secret"
    assert started == ["mac-mps"]
    assert "secret" not in capsys.readouterr().out


def test_setup_keeps_existing_profile_when_preflight_fails(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            role="training",
            server_url="https://old.example.test",
            token="old-secret",
            worker_id="trainer",
        ),
    )
    monkeypatch.setattr(worker_command.getpass, "getpass", lambda _prompt: "new-secret")
    monkeypatch.setattr(worker_command, "require_launchd", lambda: None)

    def fail_preflight(_name, _profile):
        raise ValueError("unreachable")

    monkeypatch.setattr(worker_command, "preflight_profile", fail_preflight)
    monkeypatch.setattr(
        worker_command,
        "start_service",
        lambda _name: pytest.fail("invalid profile must not start"),
    )

    result = main(
        [
            "worker",
            "setup",
            "training",
            "trainer",
            "--server",
            "https://new.example.test",
            "--force",
        ]
    )

    assert result == 2
    assert load_profile("trainer").server_url == "https://old.example.test"
    assert load_profile("trainer").token == "old-secret"
    assert "unreachable" in capsys.readouterr().err


def test_setup_restarts_a_replaced_profile(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    save_profile(
        "trainer",
        WorkerProfile(
            role="training",
            server_url="https://old.example.test",
            token="old-secret",
            worker_id="trainer",
        ),
    )
    monkeypatch.setattr(worker_command, "require_launchd", lambda: None)
    monkeypatch.setattr(worker_command.getpass, "getpass", lambda _prompt: "new-secret")
    monkeypatch.setattr(worker_command, "preflight_profile", lambda *_args: ())
    restarted: list[str] = []
    monkeypatch.setattr(worker_command, "restart_service", restarted.append)
    monkeypatch.setattr(
        worker_command,
        "start_service",
        lambda _name: pytest.fail("a replaced service must be restarted"),
    )

    assert (
        main(
            [
                "worker",
                "setup",
                "training",
                "trainer",
                "--server",
                "https://new.example.test",
                "--force",
            ]
        )
        == 0
    )
    assert restarted == ["trainer"]
    assert load_profile("trainer").token == "new-secret"


def test_setup_rejects_an_existing_profile_before_prompting(
    tmp_path, monkeypatch, capsys
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
    monkeypatch.setattr(
        worker_command.getpass,
        "getpass",
        lambda _prompt: pytest.fail("existing profile must fail before prompting"),
    )

    assert (
        main(
            [
                "worker",
                "setup",
                "training",
                "trainer",
                "--server",
                "https://example.test",
            ]
        )
        == 2
    )
    assert "already exists" in capsys.readouterr().err


def test_list_reports_each_profile(tmp_path, monkeypatch, capsys) -> None:
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

    assert main(["worker", "list"]) == 0

    assert capsys.readouterr().out == (
        "trainer\ttraining\tnever started\tnot loaded\tcpu\n"
    )
