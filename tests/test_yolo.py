import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from vitroflow.annotations import BoundingBox, ReviewedImage
from vitroflow.yolo import export_prelabel_yolo_dataset, export_yolo_dataset


def _annotation(source: str) -> ReviewedImage:
    return ReviewedImage(
        source=Path(source),
        width=100,
        height=80,
        model_version_id="batch.traditional-v1",
        artifact_digest="a" * 64,
        runtime_adapter="traditional",
        runtime_fingerprint="b" * 64,
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
    dataset_yaml = (output / "dataset.yaml").read_text()
    assert "path:" not in dataset_yaml
    assert "train: images/train" in dataset_yaml
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


def _prelabel_payload(source: str) -> dict:
    return {
        "schema_version": 2,
        "source": source,
        "image": {"width": 1000, "height": 800},
        "producer": {
            "model_version_id": "batch.traditional-v1",
            "artifact_digest": "a" * 64,
            "runtime": {
                "adapter": "traditional",
                "fingerprint": "b" * 64,
            },
        },
        "instances": [
            {
                "id": "1",
                "class": "seed",
                "bbox": {"x": 96.25, "y": 196.25, "width": 7.5, "height": 7.5},
                "score": 0.9,
            }
        ],
        "quality": {"status": "ok", "warnings": []},
    }


def test_prelabel_export_builds_standard_boxes_from_prelabels(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    prelabels = data_root / "prelabels" / "batch"
    prelabels.mkdir(parents=True)
    for name in ("a", "b"):
        source = f"images/batch/{name}.jpg"
        image_path = data_root / source
        image_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(image_path), np.zeros((800, 1000, 3), dtype=np.uint8))
        (prelabels / f"{name}.json").write_text(
            json.dumps(_prelabel_payload(source)), encoding="utf-8"
        )
    (prelabels / "c.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "source": "images/batch/c.jpg",
                "producer": _prelabel_payload("images/batch/c.jpg")["producer"],
                "error": "dish not found",
            }
        ),
        encoding="utf-8",
    )

    output = tmp_path / "yolo"
    manifest = export_prelabel_yolo_dataset(prelabels, data_root, output, seed=3)

    assert len(manifest["images"]) == 2
    assert all("revision" not in entry for entry in manifest["images"])
    labels = list((output / "labels").rglob("*.txt"))
    assert len(labels) == 2
    assert labels[0].read_text().strip().split() == [
        "0",
        "0.10000000",
        "0.25000000",
        "0.00750000",
        "0.00937500",
    ]


def test_prelabel_export_rejects_an_unversioned_document(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    prelabels = data_root / "prelabels" / "batch"
    prelabels.mkdir(parents=True)
    payload = _prelabel_payload("images/batch/a.jpg")
    del payload["schema_version"]
    for name in ("a", "b"):
        (prelabels / f"{name}.json").write_text(json.dumps(payload), encoding="utf-8")

    output = tmp_path / "yolo"
    with pytest.raises(ValueError, match="schema_version must be 2"):
        export_prelabel_yolo_dataset(prelabels, data_root, output)

    assert not output.exists()
