from __future__ import annotations

import json
from pathlib import Path

import pytest

from vitroctl.training.parameters import parse_training_parameters


def _parameters() -> dict[str, object]:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads(
        (root / "configs/yolo26/yolo26n-whole-v1.recipe.json").read_text()
    )
    return manifest["recipe"]["parameters"]


def test_training_parameters_accept_the_shared_recipe() -> None:
    parameters = _parameters()

    assert parse_training_parameters(parameters) == parameters


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("epochs", 0),
        ("patience", 301),
        ("batch", True),
        ("nbs", 0),
        ("nbs", True),
        ("nbs", 1.5),
        ("nbs", 1025),
        ("imgsz", 769),
        ("optimizer", "Other"),
        ("lr0", float("nan")),
        ("warmup_epochs", 11),
        ("mosaic", -0.1),
        ("mixup", 1.1),
        ("copy_paste", "0"),
        ("max_det", 0),
        ("seed", -1),
        ("deterministic", 1),
    ],
)
def test_training_parameters_reject_invalid_values(field: str, value: object) -> None:
    parameters = _parameters()
    parameters[field] = value

    with pytest.raises((TypeError, ValueError), match=field):
        parse_training_parameters(parameters)


def test_training_parameters_require_the_exact_field_set() -> None:
    parameters = _parameters()
    parameters.pop("epochs")

    with pytest.raises(ValueError, match="epochs"):
        parse_training_parameters(parameters)

    parameters = _parameters()
    parameters["augment"] = 1
    with pytest.raises(ValueError, match="augment"):
        parse_training_parameters(parameters)


def test_omitted_nominal_batch_retains_runtime_semantics() -> None:
    parameters = _parameters()
    parameters.pop("nbs")
    assert "nbs" not in parse_training_parameters(parameters)
    assert parse_training_parameters({**parameters, "nbs": 8})["nbs"] == 8


def test_small_2048_recipe_is_valid_and_pins_experiment_parameters() -> None:
    from vitroctl.training.recipe import load_training_recipe_manifest

    root = Path(__file__).resolve().parents[1]
    recipe = load_training_recipe_manifest(
        root / "configs/yolo26/yolo26s-whole-2048-v1.recipe.json"
    )
    assert recipe.base_model_reference == "yolo26s.pt"
    assert recipe.parameters["nbs"] == 8
    assert recipe.parameters["batch"] == 1
    assert recipe.parameters["epochs"] == 50
    assert recipe.parameters["patience"] == 0
    assert recipe.parameters["warmup_epochs"] == 0
