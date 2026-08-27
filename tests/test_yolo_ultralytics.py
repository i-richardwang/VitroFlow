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

from vitroflow.annotations import load_complete_annotations
from vitroflow.yolo import export_yolo_dataset

ultralytics = pytest.importorskip("ultralytics")


def test_seed_recipe_parameters_are_accepted_ultralytics_arguments() -> None:
    from ultralytics.cfg import get_cfg

    project_root = Path(__file__).resolve().parents[1]
    manifest = json.loads(
        (project_root / "configs/yolo26/seed-small.recipe.json").read_text()
    )
    parameters = manifest["recipe"]["parameters"]

    cfg = get_cfg(overrides=dict(parameters))

    for name, value in parameters.items():
        assert getattr(cfg, name) == value
    assert cfg.optimizer == "AdamW"
    assert cfg.mosaic == pytest.approx(0.0)
    assert cfg.max_det == 500


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
