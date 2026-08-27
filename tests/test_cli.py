import csv
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from conftest import (
    annotation_document,
    encoded_image,
    manifest_entry,
    write_blob,
    write_manifest,
)

from vitroflow.cli import main


def test_recognize_records_the_input_path_and_digest(tmp_path: Path) -> None:
    image = tmp_path / "sample.jpg"
    cv2.imwrite(str(image), np.zeros((400, 600, 3), dtype=np.uint8))
    output = tmp_path / "run"

    exit_code = main(["recognize", str(image), "--output", str(output)])

    assert exit_code == 0
    with (output / "counts.csv").open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert rows == [{"image": str(image), "count": "0"}]
    result = json.loads((output / "sample.json").read_text(encoding="utf-8"))
    assert result["path"] == str(image)
    assert result["image"]["digest"] == hashlib.sha256(image.read_bytes()).hexdigest()
    assert (output / "sample_overlay.jpg").is_file()


def test_recognize_rejects_duplicate_stems_before_publishing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    first = tmp_path / "one" / "sample.jpg"
    second = tmp_path / "two" / "sample.png"
    first.parent.mkdir(parents=True)
    second.parent.mkdir(parents=True)
    first.write_bytes(b"first")
    second.write_bytes(b"second")
    output = tmp_path / "run"

    exit_code = main(["recognize", str(first), str(second), "--output", str(output)])

    assert exit_code == 2
    assert "unique filename stems" in capsys.readouterr().err
    assert not output.exists()


def test_recognize_requires_a_new_output_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    image = tmp_path / "sample.jpg"
    image.write_bytes(b"image")
    output = tmp_path / "run"
    output.mkdir()

    exit_code = main(["recognize", str(image), "--output", str(output)])

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
    exported = sorted(path.name for path in (output / "images").rglob("*.jpg"))
    assert exported == sorted(f"{image['digest']}.jpg" for image in images)
