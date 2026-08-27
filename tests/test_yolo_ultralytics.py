from pathlib import Path

import pytest
from conftest import (
    annotation_document,
    encoded_image,
    manifest_entry,
    write_blob,
    write_manifest,
)

from vitroflow.annotations import load_complete_annotations
from vitroflow.yolo import export_yolo_dataset

ultralytics = pytest.importorskip("ultralytics")


def test_seed_finetune_config_follows_small_dataset_recipe() -> None:
    from ultralytics.utils import YAML

    project_root = Path(__file__).resolve().parents[1]
    config = YAML.load(project_root / "configs" / "yolo26" / "seed-small.yaml")

    assert config["epochs"] == 50
    assert config["patience"] == 20
    assert config["batch"] == 8
    assert config["optimizer"] == "AdamW"
    assert config["lr0"] == pytest.approx(0.001)
    assert config["warmup_epochs"] == pytest.approx(3.0)
    assert config["mosaic"] == pytest.approx(0.0)
    assert config["mixup"] == pytest.approx(0.0)
    assert config["copy_paste"] == pytest.approx(0.0)
    assert config["max_det"] == 500
    assert "nbs" not in config
    assert "close_mosaic" not in config


def test_ultralytics_resolves_exported_dataset_from_its_yaml(tmp_path: Path) -> None:
    from ultralytics.data.utils import check_det_dataset

    data_root = tmp_path / "data"
    entries = []
    for variant in range(2):
        digest = write_blob(data_root, encoded_image(variant=variant))
        entries.append(manifest_entry(digest, label=annotation_document(digest)))
    labelled = load_complete_annotations(write_manifest(data_root, "batch", entries))

    output = tmp_path / "dataset"
    export_yolo_dataset(labelled, data_root, output)

    loaded = check_det_dataset(str((output / "dataset.yaml").resolve()))

    assert Path(loaded["train"]) == (output / "images" / "train").resolve()
    assert Path(loaded["val"]) == (output / "images" / "val").resolve()
