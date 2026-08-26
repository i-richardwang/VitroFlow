from pathlib import Path

import cv2
import numpy as np
import pytest

from vitroflow.annotations import BoundingBox, ReviewedImage
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
    annotations = []
    for name in ("a", "b"):
        source = Path(f"images/batch/{name}.jpg")
        image_path = data_root / source
        image_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(image_path), np.zeros((80, 100, 3), dtype=np.uint8))
        annotations.append(
            ReviewedImage(
                source=source,
                width=100,
                height=80,
                run_id="run",
                pipeline_fingerprint="a" * 64,
                model_fingerprint="b" * 64,
                status="complete",
                revision=1,
                boxes=(BoundingBox(10, 20, 20, 10),),
            )
        )

    output = tmp_path / "dataset"
    export_yolo_dataset(annotations, data_root, output)

    loaded = check_det_dataset(str((output / "dataset.yaml").resolve()))

    assert Path(loaded["train"]) == (output / "images" / "train").resolve()
    assert Path(loaded["val"]) == (output / "images" / "val").resolve()
