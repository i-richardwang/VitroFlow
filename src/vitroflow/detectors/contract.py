from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from ..annotations import BoundingBox
from ..identifiers import CLASS_NAME, FINGERPRINT, VERSION_ID, WARNING_CODE

DETECTION_SCHEMA_VERSION = 1

_QUALITY_STATUSES = {"ok", "review_required"}
_RUNTIME_ADAPTERS = {"traditional", "ultralytics"}


def _finite(value: float, context: str) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{context} must be a number")
    if not math.isfinite(value):
        raise ValueError(f"{context} must be finite")


def _validate_digest(digest: str) -> None:
    if not isinstance(digest, str) or not FINGERPRINT.fullmatch(digest):
        raise ValueError("Detection image digest must be a SHA-256 digest")


@dataclass(frozen=True)
class RuntimeDescriptor:
    """Identity of the code/runtime executing an immutable model artifact."""

    adapter: str
    fingerprint: str

    def __post_init__(self) -> None:
        if self.adapter not in _RUNTIME_ADAPTERS:
            raise ValueError(f"Invalid runtime adapter: {self.adapter}")
        if not FINGERPRINT.fullmatch(self.fingerprint):
            raise ValueError("Runtime fingerprint must be a SHA-256 digest")

    def to_dict(self) -> dict[str, str]:
        return {
            "adapter": self.adapter,
            "fingerprint": self.fingerprint,
        }


@dataclass(frozen=True)
class DetectionProducer:
    """Business model identity plus the exact runtime used for one detection."""

    model_version_id: str
    artifact_digest: str
    runtime: RuntimeDescriptor

    def __post_init__(self) -> None:
        if not VERSION_ID.fullmatch(self.model_version_id):
            raise ValueError(f"Invalid model version id: {self.model_version_id}")
        if not FINGERPRINT.fullmatch(self.artifact_digest):
            raise ValueError("Artifact digest must be a SHA-256 digest")

    def to_dict(self) -> dict[str, object]:
        return {
            "modelVersionId": self.model_version_id,
            "artifactDigest": self.artifact_digest,
            "runtime": self.runtime.to_dict(),
        }


@dataclass(frozen=True)
class DetectionQuality:
    status: str
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.status not in _QUALITY_STATUSES:
            raise ValueError(f"Unknown detection quality status: {self.status}")
        for warning in self.warnings:
            if not isinstance(warning, str) or not WARNING_CODE.fullmatch(warning):
                raise ValueError(f"Invalid detection warning code: {warning}")

    def to_dict(self) -> dict[str, object]:
        return {"status": self.status, "warnings": list(self.warnings)}


@dataclass(frozen=True)
class DetectionInstance:
    instance_id: str
    class_name: str
    bbox: BoundingBox
    score: float

    def __post_init__(self) -> None:
        if not self.instance_id:
            raise ValueError("Detection instance id must not be empty")
        if not CLASS_NAME.fullmatch(self.class_name):
            raise ValueError(f"Invalid detection class: {self.class_name}")
        for name, value in (
            ("bbox.x", self.bbox.x),
            ("bbox.y", self.bbox.y),
            ("bbox.width", self.bbox.width),
            ("bbox.height", self.bbox.height),
            ("score", self.score),
        ):
            _finite(value, name)
        if self.bbox.x < 0 or self.bbox.y < 0:
            raise ValueError("Detection bounding box coordinates must be non-negative")
        if self.bbox.width <= 0 or self.bbox.height <= 0:
            raise ValueError("Detection bounding box dimensions must be positive")
        if not 0 <= self.score <= 1:
            raise ValueError("Detection score must be between zero and one")

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.instance_id,
            "class": self.class_name,
            "bbox": {
                "x": self.bbox.x,
                "y": self.bbox.y,
                "width": self.bbox.width,
                "height": self.bbox.height,
            },
            "score": self.score,
        }


@dataclass(frozen=True)
class DishGeometry:
    center_x: float
    center_y: float
    radius: float

    def __post_init__(self) -> None:
        _finite(self.center_x, "dish.center_x")
        _finite(self.center_y, "dish.center_y")
        _finite(self.radius, "dish.radius")
        if self.radius <= 0:
            raise ValueError("Dish radius must be positive")

    def to_dict(self) -> dict[str, float]:
        return {
            "centerX": self.center_x,
            "centerY": self.center_y,
            "radius": self.radius,
        }


@dataclass(frozen=True)
class DetectionDiagnostics:
    dish: DishGeometry | None = None
    metrics: Mapping[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name, value in self.metrics.items():
            if not isinstance(name, str) or not name:
                raise ValueError("Diagnostic metric names must not be empty")
            _finite(value, f"diagnostics.metrics.{name}")

    def to_dict(self) -> dict[str, object]:
        document: dict[str, object] = {}
        if self.dish is not None:
            document["dish"] = self.dish.to_dict()
        if self.metrics:
            document["metrics"] = dict(self.metrics)
        return document


@dataclass(frozen=True)
class DetectionResult:
    digest: str
    width: int
    height: int
    producer: DetectionProducer
    instances: tuple[DetectionInstance, ...]
    quality: DetectionQuality
    diagnostics: DetectionDiagnostics = field(default_factory=DetectionDiagnostics)

    def __post_init__(self) -> None:
        if (
            isinstance(self.width, bool)
            or not isinstance(self.width, int)
            or self.width <= 0
            or isinstance(self.height, bool)
            or not isinstance(self.height, int)
            or self.height <= 0
        ):
            raise ValueError("Detection image dimensions must be positive integers")
        _validate_digest(self.digest)
        identifiers: set[str] = set()
        for instance in self.instances:
            if instance.instance_id in identifiers:
                raise ValueError(
                    f"Duplicate detection instance id: {instance.instance_id}"
                )
            identifiers.add(instance.instance_id)
            if (
                instance.bbox.x + instance.bbox.width > self.width
                or instance.bbox.y + instance.bbox.height > self.height
            ):
                raise ValueError("Detection bounding box exceeds image bounds")

    def to_dict(self) -> dict[str, object]:
        document: dict[str, object] = {
            "schemaVersion": DETECTION_SCHEMA_VERSION,
            "image": {
                "digest": self.digest,
                "width": self.width,
                "height": self.height,
            },
            "producer": self.producer.to_dict(),
            "instances": [instance.to_dict() for instance in self.instances],
            "quality": self.quality.to_dict(),
        }
        diagnostics = self.diagnostics.to_dict()
        if diagnostics:
            document["diagnostics"] = diagnostics
        return document


@dataclass(frozen=True)
class DetectionFailure:
    digest: str
    producer: DetectionProducer
    error: str

    def __post_init__(self) -> None:
        _validate_digest(self.digest)
        if not self.error or len(self.error) > 2000:
            raise ValueError(
                "Detection failure error must contain 1 to 2000 characters"
            )

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": DETECTION_SCHEMA_VERSION,
            "image": {"digest": self.digest},
            "producer": self.producer.to_dict(),
            "error": self.error,
        }


class Detector(Protocol):
    """An executable model version that emits the canonical detection contract."""

    @property
    def runtime(self) -> RuntimeDescriptor: ...

    @property
    def artifact_digest(self) -> str: ...

    def predict(
        self, image_path: Path, digest: str, producer: DetectionProducer
    ) -> DetectionResult: ...
