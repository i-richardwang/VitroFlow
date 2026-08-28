from __future__ import annotations

import json
from pathlib import Path

import pytest

from vitroflow.training_recipe import (
    load_training_recipe_manifest,
    parse_training_recipe,
    parse_training_recipe_manifest,
)


def _recipe() -> dict[str, object]:
    return {
        "baseModel": {"reference": "yolo26n.pt", "digest": "a" * 64},
        "parameters": {
            "epochs": 3,
            "patience": 20,
            "batch": 4,
            "imgsz": 768,
            "optimizer": "AdamW",
            "lr0": 0.001,
            "warmup_epochs": 3.0,
            "mosaic": 0.0,
            "mixup": 0.0,
            "copy_paste": 0.0,
            "max_det": 500,
            "seed": 0,
            "deterministic": True,
        },
        "runtime": {"framework": "ultralytics", "version": "8.4.131"},
    }


def test_training_recipe_parser_returns_the_complete_identity() -> None:
    recipe = parse_training_recipe(_recipe())

    assert recipe.base_model_reference == "yolo26n.pt"
    assert recipe.base_model_digest == "a" * 64
    assert recipe.parameters["epochs"] == 3
    assert recipe.runtime_version == "8.4.131"


def test_training_recipe_manifest_requires_its_version_and_exact_shape() -> None:
    with pytest.raises(ValueError, match="schemaVersion"):
        parse_training_recipe_manifest({"recipe": _recipe()})
    with pytest.raises(ValueError, match="must be 1"):
        parse_training_recipe_manifest({"schemaVersion": 2, "recipe": _recipe()})
    with pytest.raises(ValueError, match="unknown notes"):
        parse_training_recipe_manifest(
            {
                "schemaVersion": 1,
                "recipe": _recipe(),
                "notes": "unexpected",
            }
        )


def test_training_recipe_requires_the_ultralytics_runtime() -> None:
    recipe = _recipe()
    recipe["runtime"] = {"framework": "other", "version": "1.0"}

    with pytest.raises(ValueError, match="framework must be ultralytics"):
        parse_training_recipe(recipe)


def test_project_recipe_loads_through_the_canonical_manifest_parser() -> None:
    root = Path(__file__).resolve().parents[1]
    path = root / "configs/yolo26/seed-small.recipe.json"
    raw = json.loads(path.read_text(encoding="utf-8"))

    recipe = load_training_recipe_manifest(path)

    assert recipe.base_model_reference == raw["recipe"]["baseModel"]["reference"]
    assert recipe.parameters == raw["recipe"]["parameters"]
