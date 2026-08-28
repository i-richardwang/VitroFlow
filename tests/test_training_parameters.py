from __future__ import annotations

import json
from pathlib import Path

import pytest

from vitroflow.training_parameters import parse_training_parameters


def _parameters() -> dict[str, object]:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "configs/yolo26/seed-small.recipe.json").read_text())
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

    with pytest.raises(ValueError, match="missing epochs"):
        parse_training_parameters(parameters)

    parameters = _parameters()
    parameters["augment"] = 1
    with pytest.raises(ValueError, match="unknown augment"):
        parse_training_parameters(parameters)
