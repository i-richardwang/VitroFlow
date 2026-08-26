from pathlib import Path

import pytest

from vitroflow.cli import main


def test_recognize_rejects_duplicate_stems_before_publishing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    data_root = tmp_path / "data"
    first = data_root / "images" / "one" / "sample.jpg"
    second = data_root / "images" / "two" / "sample.png"
    first.parent.mkdir(parents=True)
    second.parent.mkdir(parents=True)
    first.write_bytes(b"first")
    second.write_bytes(b"second")
    output = tmp_path / "run"

    exit_code = main(
        [
            "recognize",
            str(first),
            str(second),
            "--data-root",
            str(data_root),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 2
    assert "unique filename stems" in capsys.readouterr().err
    assert not output.exists()


def test_recognize_requires_a_new_output_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    data_root = tmp_path / "data"
    image = data_root / "images" / "sample.jpg"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"image")
    output = tmp_path / "run"
    output.mkdir()

    exit_code = main(
        [
            "recognize",
            str(image),
            "--data-root",
            str(data_root),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 2
    assert "already exists" in capsys.readouterr().err
