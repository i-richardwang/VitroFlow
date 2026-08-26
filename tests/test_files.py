from pathlib import Path

import pytest

from vitroflow.files import atomic_directory


def test_atomic_directory_publishes_complete_content(tmp_path: Path) -> None:
    destination = tmp_path / "artifact"

    with atomic_directory(destination) as working:
        (working / "result.json").write_text("{}\n", encoding="utf-8")
        assert not destination.exists()

    assert (destination / "result.json").read_text(encoding="utf-8") == "{}\n"


def test_atomic_directory_discards_failed_work(tmp_path: Path) -> None:
    destination = tmp_path / "artifact"

    with (
        pytest.raises(RuntimeError, match="failed"),
        atomic_directory(destination) as working,
    ):
        (working / "partial.json").write_text("{}", encoding="utf-8")
        raise RuntimeError("failed")

    assert not destination.exists()
    assert not list(tmp_path.glob(".artifact-*"))


def test_atomic_directory_requires_a_new_destination(tmp_path: Path) -> None:
    destination = tmp_path / "artifact"
    destination.mkdir()

    with (
        pytest.raises(FileExistsError, match="already exists"),
        atomic_directory(destination),
    ):
        pass
