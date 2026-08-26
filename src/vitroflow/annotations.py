from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_FINGERPRINT = re.compile(r"^[a-f0-9]{64}$")
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
    source: Path
    width: int
    height: int
    pipeline_fingerprint: str
    model_fingerprint: str
    status: str
    revision: int
    boxes: tuple[BoundingBox, ...]

    def image_path(self, data_root: str | Path) -> Path:
        return _path_within(Path(data_root), self.source)


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


def _integer(value: Any, context: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{context} must be an integer of at least {minimum}")
    return value


def _number(value: Any, context: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{context} must be a number")
    number = float(value)
    if not math.isfinite(number) or (positive and number <= 0):
        qualifier = "a finite positive number" if positive else "finite"
        raise ValueError(f"{context} must be {qualifier}")
    return number


def _path_within(root: Path, relative: Path) -> Path:
    if relative.is_absolute():
        raise ValueError(f"Image path must be relative: {relative}")
    absolute_root = Path(os.path.abspath(root))
    candidate = Path(os.path.abspath(absolute_root / relative))
    try:
        candidate.relative_to(absolute_root)
    except ValueError:
        raise ValueError(f"Image path escapes the data root: {relative}") from None
    return candidate


def _parse_box(
    value: Any, image_width: int, image_height: int, context: str
) -> BoundingBox:
    instance = _object(value, context)
    _fields(instance, {"id", "class", "bbox"}, context)
    _string(instance["id"], f"{context}.id")
    if instance["class"] != "seed":
        raise ValueError(f"{context}.class must be seed")
    bbox = _object(instance["bbox"], f"{context}.bbox")
    _fields(bbox, {"x", "y", "width", "height"}, f"{context}.bbox")
    parsed = BoundingBox(
        x=_number(bbox["x"], f"{context}.bbox.x"),
        y=_number(bbox["y"], f"{context}.bbox.y"),
        width=_number(bbox["width"], f"{context}.bbox.width", positive=True),
        height=_number(bbox["height"], f"{context}.bbox.height", positive=True),
    )
    if (
        parsed.x < 0
        or parsed.y < 0
        or parsed.x + parsed.width > image_width
        or parsed.y + parsed.height > image_height
    ):
        raise ValueError(f"{context}.bbox exceeds image bounds")
    return parsed


def load_annotation(path: str | Path, data_root: str | Path) -> ReviewedImage:
    annotation_path = Path(path)
    payload = _object(
        json.loads(annotation_path.read_text(encoding="utf-8")),
        str(annotation_path),
    )
    required = {"image", "source", "status", "revision", "instances"}
    _fields(payload, required, str(annotation_path), {"excludedReason"})

    image = _object(payload["image"], "image")
    _fields(image, {"path", "width", "height"}, "image")
    source_path = Path(_string(image["path"], "image.path"))
    image_width = _integer(image["width"], "image.width", 1)
    image_height = _integer(image["height"], "image.height", 1)
    absolute_image = _path_within(Path(data_root), source_path)
    images_root = Path(os.path.abspath(Path(data_root) / "images"))
    try:
        absolute_image.relative_to(images_root)
    except ValueError:
        raise ValueError(
            f"Image is not under the images directory: {source_path}"
        ) from None

    source = _object(payload["source"], "source")
    _fields(
        source,
        {"pipelineFingerprint", "modelFingerprint"},
        "source",
    )
    pipeline_fingerprint = _string(
        source["pipelineFingerprint"], "source.pipelineFingerprint"
    )
    model_fingerprint = _string(source["modelFingerprint"], "source.modelFingerprint")
    if not _FINGERPRINT.fullmatch(pipeline_fingerprint):
        raise ValueError("source.pipelineFingerprint must be a SHA-256 fingerprint")
    if not _FINGERPRINT.fullmatch(model_fingerprint):
        raise ValueError("source.modelFingerprint must be a SHA-256 fingerprint")

    status = _string(payload["status"], "status")
    if status not in _STATUSES:
        raise ValueError(f"Unknown annotation status: {status}")
    excluded_reason = payload.get("excludedReason")
    if status != "excluded" and excluded_reason is not None:
        raise ValueError("Only excluded images can have an exclusion reason")
    if excluded_reason is not None:
        _string(excluded_reason, "excludedReason")

    raw_instances = payload["instances"]
    if not isinstance(raw_instances, list):
        raise TypeError("instances must be an array")
    identifiers: set[str] = set()
    boxes: list[BoundingBox] = []
    for index, raw_instance in enumerate(raw_instances):
        instance = _object(raw_instance, f"instances[{index}]")
        identifier = _string(instance.get("id"), f"instances[{index}].id")
        if identifier in identifiers:
            raise ValueError(f"Duplicate instance id: {identifier}")
        identifiers.add(identifier)
        boxes.append(
            _parse_box(instance, image_width, image_height, f"instances[{index}]")
        )

    return ReviewedImage(
        source=source_path,
        width=image_width,
        height=image_height,
        pipeline_fingerprint=pipeline_fingerprint,
        model_fingerprint=model_fingerprint,
        status=status,
        revision=_integer(payload["revision"], "revision"),
        boxes=tuple(boxes),
    )


def load_annotations(
    labels_dir: str | Path, data_root: str | Path
) -> list[ReviewedImage]:
    directory = Path(labels_dir)
    if not directory.is_dir():
        raise FileNotFoundError(directory)
    annotations = [
        load_annotation(path, data_root) for path in sorted(directory.rglob("*.json"))
    ]
    sources: set[Path] = set()
    for annotation in annotations:
        if annotation.source in sources:
            raise ValueError(f"Duplicate annotation source: {annotation.source}")
        sources.add(annotation.source)
    return annotations


def load_complete_annotations(
    labels_dir: str | Path, data_root: str | Path
) -> list[ReviewedImage]:
    return [
        annotation
        for annotation in load_annotations(labels_dir, data_root)
        if annotation.status == "complete"
    ]
