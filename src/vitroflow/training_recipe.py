"""The canonical YOLO training recipe contract."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .documents import (
    as_digest,
    as_object,
    as_string,
    expect_fields,
    expect_schema_version,
)
from .training_parameters import parse_training_parameters

TRAINING_RECIPE_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class TrainingRecipe:
    """A validated training identity carried by every run and model version."""

    base_model_reference: str
    base_model_digest: str
    parameters: dict[str, Any]
    runtime_version: str


def parse_training_recipe(value: Any, context: str = "recipe") -> TrainingRecipe:
    recipe = as_object(value, context)
    expect_fields(recipe, {"baseModel", "parameters", "runtime"}, context)

    base_model = as_object(recipe["baseModel"], f"{context}.baseModel")
    expect_fields(base_model, {"reference", "digest"}, f"{context}.baseModel")

    runtime = as_object(recipe["runtime"], f"{context}.runtime")
    expect_fields(runtime, {"framework", "version"}, f"{context}.runtime")
    if runtime["framework"] != "ultralytics":
        raise ValueError(f"{context}.runtime.framework must be ultralytics")

    return TrainingRecipe(
        base_model_reference=as_string(
            base_model["reference"], f"{context}.baseModel.reference"
        ),
        base_model_digest=as_digest(
            base_model["digest"], f"{context}.baseModel.digest"
        ),
        parameters=parse_training_parameters(
            recipe["parameters"], f"{context}.parameters"
        ),
        runtime_version=as_string(runtime["version"], f"{context}.runtime.version"),
    )


def parse_training_recipe_manifest(
    value: Any, context: str = "training recipe manifest"
) -> TrainingRecipe:
    manifest = as_object(value, context)
    expect_fields(manifest, {"schemaVersion", "recipe"}, context)
    expect_schema_version(
        manifest,
        "schemaVersion",
        TRAINING_RECIPE_SCHEMA_VERSION,
        context,
    )
    return parse_training_recipe(manifest["recipe"], f"{context}.recipe")


def load_training_recipe_manifest(path: Path) -> TrainingRecipe:
    """Load and validate a recipe manifest from its canonical JSON form."""

    return parse_training_recipe_manifest(
        json.loads(path.read_text(encoding="utf-8")),
        str(path),
    )
