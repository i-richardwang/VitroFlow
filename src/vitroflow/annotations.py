"""Reviewed box annotations: the canonical training data of a dataset."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .documents import (
    as_digest,
    as_integer,
    as_list,
    as_number,
    as_object,
    as_string,
    expect_fields,
    expect_schema_version,
)
from .identifiers import FINGERPRINT, VERSION_ID
from .manifest import ManifestImage, load_dataset_manifest

ANNOTATION_SCHEMA_VERSION = 1
_STATUSES = {"in_progress", "complete", "excluded"}


@dataclass(frozen=True)
class BoundingBox:
    x: float
    y: float
    width: float
    height: float

    @property
    def center(self) -> tuple[float, float]:
        return self.x + self.width / 2.0, self.y + self.height / 2.0

    def contains(self, x: float, y: float) -> bool:
        return (
            self.x <= x <= self.x + self.width and self.y <= y <= self.y + self.height
        )


@dataclass(frozen=True)
class ReviewedImage:
    digest: str
    width: int
    height: int
    model_version_id: str
    artifact_digest: str
    runtime_adapter: str
    runtime_fingerprint: str
    status: str
    revision: int
    boxes: tuple[BoundingBox, ...]


@dataclass(frozen=True)
class LabelledImage:
    """A manifest entry together with the annotation recorded for it."""

    entry: ManifestImage
    annotation: ReviewedImage


def _parse_box(
    value: dict[str, Any], image_width: int, image_height: int, context: str
) -> BoundingBox:
    bbox = as_object(value, context)
    expect_fields(bbox, {"x", "y", "width", "height"}, context)
    parsed = BoundingBox(
        x=as_number(bbox["x"], f"{context}.x"),
        y=as_number(bbox["y"], f"{context}.y"),
        width=as_number(bbox["width"], f"{context}.width", positive=True),
        height=as_number(bbox["height"], f"{context}.height", positive=True),
    )
    if (
        parsed.x < 0
        or parsed.y < 0
        or parsed.x + parsed.width > image_width
        or parsed.y + parsed.height > image_height
    ):
        raise ValueError(f"{context} exceeds image bounds")
    return parsed


def _parse_instances(
    value: Any, image_width: int, image_height: int, context: str
) -> tuple[BoundingBox, ...]:
    identifiers: set[str] = set()
    boxes: list[BoundingBox] = []
    for index, raw_instance in enumerate(as_list(value, context)):
        instance_context = f"{context}[{index}]"
        instance = as_object(raw_instance, instance_context)
        expect_fields(instance, {"id", "class", "bbox"}, instance_context)
        identifier = as_string(instance["id"], f"{instance_context}.id")
        if identifier in identifiers:
            raise ValueError(f"{instance_context}.id is a duplicate: {identifier}")
        identifiers.add(identifier)
        if instance["class"] != "seed":
            raise ValueError(f"{instance_context}.class must be seed")
        boxes.append(
            _parse_box(
                instance["bbox"], image_width, image_height, f"{instance_context}.bbox"
            )
        )
    return tuple(boxes)


def parse_annotation(value: Any, context: str = "annotation") -> ReviewedImage:
    payload = as_object(value, context)
    expect_fields(
        payload,
        {"schemaVersion", "image", "source", "status", "revision", "instances"},
        context,
        {"excludedReason"},
    )
    expect_schema_version(payload, "schemaVersion", ANNOTATION_SCHEMA_VERSION, context)

    image_context = f"{context}.image"
    image = as_object(payload["image"], image_context)
    expect_fields(image, {"digest", "width", "height"}, image_context)
    digest = as_digest(image["digest"], f"{image_context}.digest")
    image_width = as_integer(image["width"], f"{image_context}.width", 1)
    image_height = as_integer(image["height"], f"{image_context}.height", 1)

    source_context = f"{context}.source"
    source = as_object(payload["source"], source_context)
    expect_fields(
        source, {"modelVersionId", "artifactDigest", "runtime"}, source_context
    )
    model_version_id = as_string(
        source["modelVersionId"], f"{source_context}.modelVersionId"
    )
    if not VERSION_ID.fullmatch(model_version_id):
        raise ValueError(f"{source_context}.modelVersionId is invalid")
    artifact_digest = as_digest(
        source["artifactDigest"], f"{source_context}.artifactDigest"
    )
    runtime_context = f"{source_context}.runtime"
    runtime = as_object(source["runtime"], runtime_context)
    expect_fields(runtime, {"adapter", "fingerprint"}, runtime_context)
    runtime_adapter = as_string(runtime["adapter"], f"{runtime_context}.adapter")
    if not VERSION_ID.fullmatch(runtime_adapter):
        raise ValueError(f"{runtime_context}.adapter is invalid")
    runtime_fingerprint = as_string(
        runtime["fingerprint"], f"{runtime_context}.fingerprint"
    )
    if not FINGERPRINT.fullmatch(runtime_fingerprint):
        raise ValueError(f"{runtime_context}.fingerprint must be a SHA-256 fingerprint")

    status = as_string(payload["status"], f"{context}.status")
    if status not in _STATUSES:
        raise ValueError(f"{context}.status is unknown: {status}")
    excluded_reason = payload.get("excludedReason")
    if excluded_reason is not None:
        as_string(excluded_reason, f"{context}.excludedReason")
        if status != "excluded":
            raise ValueError(f"{context}.excludedReason requires excluded status")

    return ReviewedImage(
        digest=digest,
        width=image_width,
        height=image_height,
        model_version_id=model_version_id,
        artifact_digest=artifact_digest,
        runtime_adapter=runtime_adapter,
        runtime_fingerprint=runtime_fingerprint,
        status=status,
        revision=as_integer(payload["revision"], f"{context}.revision"),
        boxes=_parse_instances(
            payload["instances"], image_width, image_height, f"{context}.instances"
        ),
    )


def load_annotations(manifest: str | Path) -> list[LabelledImage]:
    """Every labelled image of a dataset manifest, in manifest order."""
    labelled = []
    for index, entry in enumerate(load_dataset_manifest(manifest).images):
        if entry.label is None:
            continue
        annotation = parse_annotation(entry.label, f"{manifest}: images[{index}].label")
        if annotation.digest != entry.digest:
            raise ValueError(f"Label digest differs from its image: {entry.digest}")
        labelled.append(LabelledImage(entry, annotation))
    return labelled


def load_complete_annotations(manifest: str | Path) -> list[LabelledImage]:
    return [
        image
        for image in load_annotations(manifest)
        if image.annotation.status == "complete"
    ]
