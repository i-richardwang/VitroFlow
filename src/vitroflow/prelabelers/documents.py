from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ..annotations import BoundingBox
from .contract import (
    DishGeometry,
    PredictionProducer,
    PrelabelDiagnostics,
    PrelabelFailure,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
    RuntimeDescriptor,
)

PrelabelDocument = PrelabelResult | PrelabelFailure


def _object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(f"{context} must be an object")
    return value


def _fields(
    value: dict[str, Any],
    required: set[str],
    context: str,
    optional: set[str] | None = None,
) -> None:
    allowed = required | (optional or set())
    missing = required - set(value)
    extra = set(value) - allowed
    if missing or extra:
        details = []
        if missing:
            details.append(f"missing {', '.join(sorted(missing))}")
        if extra:
            details.append(f"unknown {', '.join(sorted(extra))}")
        raise ValueError(f"{context} fields are invalid: {'; '.join(details)}")


def _string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{context} must be a non-empty string")
    return value


def _integer(value: Any, context: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{context} must be a positive integer")
    return value


def _number(value: Any, context: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{context} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{context} must be finite")
    return number


def _runtime(value: Any, context: str) -> RuntimeDescriptor:
    descriptor = _object(value, context)
    _fields(descriptor, {"adapter", "fingerprint"}, context)
    return RuntimeDescriptor(
        adapter=_string(descriptor["adapter"], f"{context}.adapter"),
        fingerprint=_string(descriptor["fingerprint"], f"{context}.fingerprint"),
    )


def _producer(value: Any, context: str) -> PredictionProducer:
    producer = _object(value, context)
    _fields(
        producer,
        {"model_version_id", "artifact_digest", "runtime"},
        context,
    )
    return PredictionProducer(
        model_version_id=_string(
            producer["model_version_id"], f"{context}.model_version_id"
        ),
        artifact_digest=_string(
            producer["artifact_digest"], f"{context}.artifact_digest"
        ),
        runtime=_runtime(producer["runtime"], f"{context}.runtime"),
    )


def _diagnostics(value: Any, context: str) -> PrelabelDiagnostics:
    diagnostics = _object(value, context)
    _fields(diagnostics, set(), context, {"dish", "metrics"})
    dish = None
    if "dish" in diagnostics:
        raw_dish = _object(diagnostics["dish"], f"{context}.dish")
        _fields(raw_dish, {"center_x", "center_y", "radius"}, f"{context}.dish")
        dish = DishGeometry(
            center_x=_number(raw_dish["center_x"], f"{context}.dish.center_x"),
            center_y=_number(raw_dish["center_y"], f"{context}.dish.center_y"),
            radius=_number(raw_dish["radius"], f"{context}.dish.radius"),
        )
    metrics: dict[str, float] = {}
    if "metrics" in diagnostics:
        raw_metrics = _object(diagnostics["metrics"], f"{context}.metrics")
        metrics = {
            _string(name, f"{context}.metrics key"): _number(
                metric, f"{context}.metrics.{name}"
            )
            for name, metric in raw_metrics.items()
        }
    return PrelabelDiagnostics(dish=dish, metrics=metrics)


def parse_prelabel_document(value: Any, context: str = "prelabel") -> PrelabelDocument:
    payload = _object(value, context)
    schema_version = payload.get("schema_version")
    if isinstance(schema_version, bool) or schema_version != 2:
        raise ValueError(f"{context}.schema_version must be 2")
    source = Path(_string(payload.get("source"), f"{context}.source"))
    producer = _producer(payload.get("producer"), f"{context}.producer")

    if "error" in payload:
        _fields(payload, {"schema_version", "source", "producer", "error"}, context)
        return PrelabelFailure(
            source=source,
            producer=producer,
            error=_string(payload["error"], f"{context}.error"),
        )

    _fields(
        payload,
        {"schema_version", "source", "image", "producer", "instances", "quality"},
        context,
        {"diagnostics"},
    )
    image = _object(payload["image"], f"{context}.image")
    _fields(image, {"width", "height"}, f"{context}.image")

    raw_instances = payload["instances"]
    if not isinstance(raw_instances, list):
        raise TypeError(f"{context}.instances must be an array")
    instances = []
    for index, raw_instance in enumerate(raw_instances):
        instance_context = f"{context}.instances[{index}]"
        instance = _object(raw_instance, instance_context)
        _fields(instance, {"id", "class", "bbox", "score"}, instance_context)
        if instance["class"] != "seed":
            raise ValueError(f"{instance_context}.class must be seed")
        raw_bbox = _object(instance["bbox"], f"{instance_context}.bbox")
        _fields(
            raw_bbox,
            {"x", "y", "width", "height"},
            f"{instance_context}.bbox",
        )
        instances.append(
            PrelabelInstance(
                instance_id=_string(instance["id"], f"{instance_context}.id"),
                bbox=BoundingBox(
                    x=_number(raw_bbox["x"], f"{instance_context}.bbox.x"),
                    y=_number(raw_bbox["y"], f"{instance_context}.bbox.y"),
                    width=_number(raw_bbox["width"], f"{instance_context}.bbox.width"),
                    height=_number(
                        raw_bbox["height"], f"{instance_context}.bbox.height"
                    ),
                ),
                score=_number(instance["score"], f"{instance_context}.score"),
            )
        )

    quality = _object(payload["quality"], f"{context}.quality")
    _fields(quality, {"status", "warnings"}, f"{context}.quality")
    raw_warnings = quality["warnings"]
    if not isinstance(raw_warnings, list):
        raise TypeError(f"{context}.quality.warnings must be an array")

    return PrelabelResult(
        source=source,
        width=_integer(image["width"], f"{context}.image.width"),
        height=_integer(image["height"], f"{context}.image.height"),
        producer=producer,
        instances=tuple(instances),
        quality=PrelabelQuality(
            status=_string(quality["status"], f"{context}.quality.status"),
            warnings=tuple(
                _string(warning, f"{context}.quality.warnings[{index}]")
                for index, warning in enumerate(raw_warnings)
            ),
        ),
        diagnostics=(
            _diagnostics(payload["diagnostics"], f"{context}.diagnostics")
            if "diagnostics" in payload
            else PrelabelDiagnostics()
        ),
    )


def load_prelabel_document(path: str | Path) -> PrelabelDocument:
    source = Path(path)
    return parse_prelabel_document(
        json.loads(source.read_text(encoding="utf-8")), str(source)
    )
