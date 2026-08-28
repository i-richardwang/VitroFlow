import csv
import json
from pathlib import Path

import pytest
from conftest import (
    annotation_document,
    encoded_image,
    manifest_entry,
    write_blob,
    write_manifest,
)

from vitroflow.cli import main
from vitroflow.image_io import CANONICAL_EXTENSION
from vitroflow.manifest import blob_path


def _pulled_dataset(data_root: Path, count: int = 1) -> list[str]:
    """A data root holding `count` images of one dataset, as ``dataset pull`` leaves it."""
    digests = [
        write_blob(data_root, encoded_image(variant=variant))
        for variant in range(count)
    ]
    write_manifest(data_root, "seeds", [manifest_entry(digest) for digest in digests])
    return digests


def test_recognize_reads_the_images_of_a_pulled_dataset(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    digest = _pulled_dataset(data_root)[0]
    output = tmp_path / "run"

    exit_code = main(
        [
            "recognize",
            "--dataset",
            "seeds",
            "--data-root",
            str(data_root),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    with (output / "counts.csv").open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert rows == [{"image": str(blob_path(data_root, digest)), "count": "0"}]
    result = json.loads((output / f"{digest}.json").read_text(encoding="utf-8"))
    assert result["image"]["digest"] == digest
    assert (output / f"{digest}_overlay.jpg").is_file()


def test_recognize_refuses_a_blob_that_fails_its_digest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    data_root = tmp_path / "data"
    digest = _pulled_dataset(data_root)[0]
    blob_path(data_root, digest).write_bytes(b"corrupted")
    output = tmp_path / "run"

    exit_code = main(
        [
            "recognize",
            "--dataset",
            "seeds",
            "--data-root",
            str(data_root),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 2
    assert digest in capsys.readouterr().err
    assert not output.exists()


def test_recognize_requires_a_new_output_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    data_root = tmp_path / "data"
    _pulled_dataset(data_root)
    output = tmp_path / "run"
    output.mkdir()

    exit_code = main(
        [
            "recognize",
            "--dataset",
            "seeds",
            "--data-root",
            str(data_root),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 2
    assert "already exists" in capsys.readouterr().err


def test_dataset_pull_requires_server_and_token(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("VITROFLOW_SERVER_URL", raising=False)
    monkeypatch.delenv("VITROFLOW_EXPORT_TOKEN", raising=False)

    exit_code = main(
        ["dataset", "pull", "--dataset", "seeds", "--data-root", str(tmp_path / "data")]
    )

    assert exit_code == 2
    error = capsys.readouterr().err
    assert "VITROFLOW_SERVER_URL" in error
    assert "VITROFLOW_EXPORT_TOKEN" in error


def test_export_yolo_reads_the_pulled_dataset_manifest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    data_root = tmp_path / "data"
    images = []
    for variant in range(2):
        digest = write_blob(data_root, encoded_image(variant=variant))
        images.append(manifest_entry(digest, label=annotation_document(digest, [])))
    write_manifest(data_root, "seeds", images)
    output = tmp_path / "yolo"

    exit_code = main(
        [
            "dataset",
            "export-yolo",
            "--dataset",
            "seeds",
            "--data-root",
            str(data_root),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    assert "exported 2 images" in capsys.readouterr().out
    exported = sorted(
        path.name for path in (output / "images").rglob(f"*{CANONICAL_EXTENSION}")
    )
    assert exported == sorted(
        f"{image['digest']}{CANONICAL_EXTENSION}" for image in images
    )
