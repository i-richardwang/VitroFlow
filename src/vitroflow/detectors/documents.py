from __future__ import annotations

from typing import Any

from ..annotations import BoundingBox
from ..documents import (
    as_integer,
    as_list,
    as_number,
    as_object,
    as_string,
    expect_fields,
    expect_schema_version,
)
from .contract import (
    DETECTION_SCHEMA_VERSION,
    DetectionDiagnostics,
    DetectionFailure,
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    DishGeometry,
    RuntimeDescriptor,
)

InferenceOutcome = DetectionResult | DetectionFailure


def _runtime(value: Any, context: str) -> RuntimeDescriptor:
    descriptor = as_object(value, context)
    expect_fields(descriptor, {"adapter", "fingerprint"}, context)
    return RuntimeDescriptor(
        adapter=as_string(descriptor["adapter"], f"{context}.adapter"),
        fingerprint=as_string(descriptor["fingerprint"], f"{context}.fingerprint"),
    )


def _producer(value: Any, context: str) -> DetectionProducer:
    producer = as_object(value, context)
    expect_fields(producer, {"model_version_id", "artifact_digest", "runtime"}, context)
    return DetectionProducer(
        model_version_id=as_string(
            producer["model_version_id"], f"{context}.model_version_id"
        ),
        artifact_digest=as_string(
            producer["artifact_digest"], f"{context}.artifact_digest"
        ),
        runtime=_runtime(producer["runtime"], f"{context}.runtime"),
    )


def _diagnostics(value: Any, context: str) -> DetectionDiagnostics:
    diagnostics = as_object(value, context)
    expect_fields(diagnostics, set(), context, {"dish", "metrics"})
    dish = None
    if "dish" in diagnostics:
        raw_dish = as_object(diagnostics["dish"], f"{context}.dish")
        expect_fields(raw_dish, {"center_x", "center_y", "radius"}, f"{context}.dish")
        dish = DishGeometry(
            center_x=as_number(raw_dish["center_x"], f"{context}.dish.center_x"),
            center_y=as_number(raw_dish["center_y"], f"{context}.dish.center_y"),
            radius=as_number(raw_dish["radius"], f"{context}.dish.radius"),
        )
    metrics: dict[str, float] = {}
    if "metrics" in diagnostics:
        raw_metrics = as_object(diagnostics["metrics"], f"{context}.metrics")
        metrics = {
            as_string(name, f"{context}.metrics key"): as_number(
                metric, f"{context}.metrics.{name}"
            )
            for name, metric in raw_metrics.items()
        }
    return DetectionDiagnostics(dish=dish, metrics=metrics)


def _instance(value: Any, context: str) -> DetectionInstance:
    instance = as_object(value, context)
    expect_fields(instance, {"id", "class", "bbox", "score"}, context)
    bbox_context = f"{context}.bbox"
    raw_bbox = as_object(instance["bbox"], bbox_context)
    expect_fields(raw_bbox, {"x", "y", "width", "height"}, bbox_context)
    return DetectionInstance(
        instance_id=as_string(instance["id"], f"{context}.id"),
        class_name=as_string(instance["class"], f"{context}.class"),
        bbox=BoundingBox(
            x=as_number(raw_bbox["x"], f"{bbox_context}.x"),
            y=as_number(raw_bbox["y"], f"{bbox_context}.y"),
            width=as_number(raw_bbox["width"], f"{bbox_context}.width"),
            height=as_number(raw_bbox["height"], f"{bbox_context}.height"),
        ),
        score=as_number(instance["score"], f"{context}.score"),
    )


def parse_inference_outcome(value: Any, context: str = "outcome") -> InferenceOutcome:
    payload = as_object(value, context)
    expect_schema_version(payload, "schema_version", DETECTION_SCHEMA_VERSION, context)
    image_context = f"{context}.image"
    image = as_object(payload.get("image"), image_context)
    producer = _producer(payload.get("producer"), f"{context}.producer")

    if "error" in payload:
        expect_fields(
            payload, {"schema_version", "image", "producer", "error"}, context
        )
        expect_fields(image, {"digest"}, image_context)
        return DetectionFailure(
            digest=as_string(image["digest"], f"{image_context}.digest"),
            producer=producer,
            error=as_string(payload["error"], f"{context}.error"),
        )

    expect_fields(
        payload,
        {"schema_version", "image", "producer", "instances", "quality"},
        context,
        {"diagnostics"},
    )
    expect_fields(image, {"digest", "width", "height"}, image_context)
    quality_context = f"{context}.quality"
    quality = as_object(payload["quality"], quality_context)
    expect_fields(quality, {"status", "warnings"}, quality_context)
    warnings = as_list(quality["warnings"], f"{quality_context}.warnings")

    return DetectionResult(
        digest=as_string(image["digest"], f"{image_context}.digest"),
        width=as_integer(image["width"], f"{image_context}.width", 1),
        height=as_integer(image["height"], f"{image_context}.height", 1),
        producer=producer,
        instances=tuple(
            _instance(raw, f"{context}.instances[{index}]")
            for index, raw in enumerate(
                as_list(payload["instances"], f"{context}.instances")
            )
        ),
        quality=DetectionQuality(
            status=as_string(quality["status"], f"{quality_context}.status"),
            warnings=tuple(
                as_string(warning, f"{quality_context}.warnings[{index}]")
                for index, warning in enumerate(warnings)
            ),
        ),
        diagnostics=(
            _diagnostics(payload["diagnostics"], f"{context}.diagnostics")
            if "diagnostics" in payload
            else DetectionDiagnostics()
        ),
    )
