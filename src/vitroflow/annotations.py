"""Box annotations: the canonical training data of a dataset."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

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
from .identifiers import CLASS_NAME, FINGERPRINT, VERSION_ID
from .manifest import ManifestImage, load_dataset_manifest

ANNOTATION_SCHEMA_VERSION = 1
_STATUSES = {"in_progress", "complete", "excluded"}
AnnotationStatus = Literal["in_progress", "complete", "excluded"]


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
class AnnotationInstance:
    instance_id: str
    class_name: str
    bbox: BoundingBox


@dataclass(frozen=True)
class AnnotationDocument:
    digest: str
    width: int
    height: int
    model_version_id: str
    artifact_digest: str
    runtime_adapter: str
    runtime_fingerprint: str
    status: AnnotationStatus
    excluded_reason: str | None
    revision: int
    instances: tuple[AnnotationInstance, ...]


@dataclass(frozen=True)
class AnnotatedImage:
    """A manifest entry together with the annotation recorded for it."""

    entry: ManifestImage
    annotation: AnnotationDocument


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
) -> tuple[AnnotationInstance, ...]:
    identifiers: set[str] = set()
    instances: list[AnnotationInstance] = []
    for index, raw_instance in enumerate(as_list(value, context)):
        instance_context = f"{context}[{index}]"
        instance = as_object(raw_instance, instance_context)
        expect_fields(instance, {"id", "class", "bbox"}, instance_context)
        identifier = as_string(instance["id"], f"{instance_context}.id")
        if identifier in identifiers:
            raise ValueError(f"{instance_context}.id is a duplicate: {identifier}")
        identifiers.add(identifier)
        class_name = as_string(instance["class"], f"{instance_context}.class")
        if not CLASS_NAME.fullmatch(class_name):
            raise ValueError(f"{instance_context}.class is invalid")
        instances.append(
            AnnotationInstance(
                instance_id=identifier,
                class_name=class_name,
                bbox=_parse_box(
                    instance["bbox"],
                    image_width,
                    image_height,
                    f"{instance_context}.bbox",
                ),
            )
        )
    return tuple(instances)


def parse_annotation(value: Any, context: str = "annotation") -> AnnotationDocument:
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
    raw_excluded_reason = payload.get("excludedReason")
    excluded_reason = (
        None
        if raw_excluded_reason is None
        else as_string(raw_excluded_reason, f"{context}.excludedReason")
    )
    if excluded_reason is not None and status != "excluded":
        raise ValueError(f"{context}.excludedReason requires excluded status")

    return AnnotationDocument(
        digest=digest,
        width=image_width,
        height=image_height,
        model_version_id=model_version_id,
        artifact_digest=artifact_digest,
        runtime_adapter=runtime_adapter,
        runtime_fingerprint=runtime_fingerprint,
        status=cast(AnnotationStatus, status),
        excluded_reason=excluded_reason,
        revision=as_integer(payload["revision"], f"{context}.revision"),
        instances=_parse_instances(
            payload["instances"], image_width, image_height, f"{context}.instances"
        ),
    )


def load_annotations(manifest: str | Path) -> list[AnnotatedImage]:
    """Every annotated image of a dataset manifest, in manifest order."""
    dataset = load_dataset_manifest(manifest)
    known_classes = set(dataset.classes)
    annotated = []
    for index, entry in enumerate(dataset.images):
        if entry.annotation is None:
            continue
        annotation = parse_annotation(
            entry.annotation, f"{manifest}: images[{index}].annotation"
        )
        if annotation.digest != entry.digest:
            raise ValueError(
                f"Annotation digest differs from its image: {entry.digest}"
            )
        unknown = sorted(
            {instance.class_name for instance in annotation.instances} - known_classes
        )
        if unknown:
            raise ValueError(
                f"Annotation for {entry.digest} uses unknown class"
                f"{'es' if len(unknown) > 1 else ''}: {', '.join(unknown)}"
            )
        annotated.append(AnnotatedImage(entry, annotation))
    return annotated


def load_complete_annotations(manifest: str | Path) -> list[AnnotatedImage]:
    return [
        image
        for image in load_annotations(manifest)
        if image.annotation.status == "complete"
    ]
