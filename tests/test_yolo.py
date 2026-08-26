from pathlib import Path

import cv2
import numpy as np
import pytest

from vitroflow.annotations import BoundingBox, ReviewedImage
from vitroflow.yolo import export_yolo_dataset


def _annotation(source: str) -> ReviewedImage:
    return ReviewedImage(
        source=Path(source),
        width=100,
        height=80,
        run_id="run",
        pipeline_fingerprint="a" * 64,
        model_fingerprint="b" * 64,
        status="complete",
        revision=2,
        boxes=(BoundingBox(10, 20, 20, 10),),
    )


def test_yolo_export_is_deterministic_and_self_contained(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotations = [
        _annotation("images/batch/a.jpg"),
        _annotation("images/batch/b.jpg"),
    ]
    for annotation in annotations:
        image_path = annotation.image_path(data_root)
        image_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(image_path), np.zeros((80, 100, 3), dtype=np.uint8))

    output = tmp_path / "yolo"
    manifest = export_yolo_dataset(annotations, data_root, output, seed=7)

    entries = manifest["images"]
    assert isinstance(entries, list)
    assert {entry["split"] for entry in entries} == {"train", "val"}
    assert (output / "dataset.yaml").is_file()
    assert len(list((output / "images").rglob("*.jpg"))) == 2
    labels = list((output / "labels").rglob("*.txt"))
    assert len(labels) == 2
    assert labels[0].read_text().strip().split() == [
        "0",
        "0.20000000",
        "0.31250000",
        "0.20000000",
        "0.12500000",
    ]

    with pytest.raises(FileExistsError, match="already exists"):
        export_yolo_dataset(annotations, data_root, output, seed=7)


def test_yolo_export_discards_an_invalid_dataset(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    annotations = [
        _annotation("images/batch/a.jpg"),
        _annotation("images/batch/b.jpg"),
    ]
    for index, annotation in enumerate(annotations):
        image_path = annotation.image_path(data_root)
        image_path.parent.mkdir(parents=True, exist_ok=True)
        height = 80 if index == 0 else 60
        cv2.imwrite(str(image_path), np.zeros((height, 100, 3), dtype=np.uint8))
    output = tmp_path / "yolo"

    with pytest.raises(ValueError, match="dimensions differ"):
        export_yolo_dataset(annotations, data_root, output)

    assert not output.exists()
    assert not list(tmp_path.glob(".yolo-*"))
