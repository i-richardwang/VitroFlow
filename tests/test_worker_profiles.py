from __future__ import annotations

import stat

import pytest

from vitroflow.worker_profiles import (
    WorkerProfile,
    list_profiles,
    load_profile,
    save_profile,
)


def test_profile_round_trip_is_private(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    profile = WorkerProfile(
        role="inference",
        server_url="https://example.test/",
        token="secret",
        worker_id="mac-studio-seed-v3",
        device="mps",
    )

    path = save_profile("seed-v3", profile)

    assert load_profile("seed-v3") == profile
    assert list_profiles() == ("seed-v3",)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700


def test_profile_rejects_an_unknown_device() -> None:
    with pytest.raises(ValueError, match="device must be"):
        WorkerProfile(
            role="training",
            server_url="https://example.test",
            token="secret",
            worker_id="trainer",
            device="gpu",
        )


def test_profile_parser_rejects_unknown_fields(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VITROFLOW_HOME", str(tmp_path))
    path = tmp_path / "profiles" / "bad" / "config.toml"
    path.parent.mkdir(parents=True)
    path.write_text(
        'role = "training"\nserver_url = "https://example.test"\n'
        'token = "secret"\nworker_id = "trainer"\nunexpected = true\n',
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="unknown worker profile fields"):
        load_profile("bad")
