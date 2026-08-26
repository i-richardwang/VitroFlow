from __future__ import annotations

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from ..annotations import BoundingBox

_VERSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_FINGERPRINT = re.compile(r"^[a-f0-9]{64}$")
_CODE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
_QUALITY_STATUSES = {"ok", "review_required"}


def _finite(value: float, context: str) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{context} must be a number")
    if not math.isfinite(value):
        raise ValueError(f"{context} must be finite")


def _validate_source(source: Path) -> None:
    if (
        source.is_absolute()
        or not source.parts
        or source.parts[0] != "images"
        or ".." in source.parts
        or "\\" in source.as_posix()
    ):
        raise ValueError("Prelabel source must be a relative path under images")


@dataclass(frozen=True)
class PrelabelerDescriptor:
    """Stable identity of one executable prelabel implementation."""

    version_id: str
    name: str
    kind: str
    fingerprint: str

    def __post_init__(self) -> None:
        if not _VERSION_ID.fullmatch(self.version_id):
            raise ValueError(f"Invalid prelabeler version id: {self.version_id}")
        if not self.name:
            raise ValueError("Prelabeler name must not be empty")
        if not _VERSION_ID.fullmatch(self.kind):
            raise ValueError(f"Invalid prelabeler kind: {self.kind}")
        if not _FINGERPRINT.fullmatch(self.fingerprint):
            raise ValueError("Prelabeler fingerprint must be a SHA-256 digest")

    def to_dict(self) -> dict[str, str]:
        return {
            "version_id": self.version_id,
            "name": self.name,
            "kind": self.kind,
            "fingerprint": self.fingerprint,
        }


@dataclass(frozen=True)
class PrelabelQuality:
    status: str
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.status not in _QUALITY_STATUSES:
            raise ValueError(f"Unknown prelabel quality status: {self.status}")
        for warning in self.warnings:
            if not isinstance(warning, str) or not _CODE.fullmatch(warning):
                raise ValueError(f"Invalid prelabel warning code: {warning}")

    def to_dict(self) -> dict[str, object]:
        return {"status": self.status, "warnings": list(self.warnings)}


@dataclass(frozen=True)
class PrelabelInstance:
    instance_id: str
    bbox: BoundingBox
    score: float

    def __post_init__(self) -> None:
        if not self.instance_id:
            raise ValueError("Prelabel instance id must not be empty")
        for name, value in (
            ("bbox.x", self.bbox.x),
            ("bbox.y", self.bbox.y),
            ("bbox.width", self.bbox.width),
            ("bbox.height", self.bbox.height),
            ("score", self.score),
        ):
            _finite(value, name)
        if self.bbox.x < 0 or self.bbox.y < 0:
            raise ValueError("Prelabel bounding box coordinates must be non-negative")
        if self.bbox.width <= 0 or self.bbox.height <= 0:
            raise ValueError("Prelabel bounding box dimensions must be positive")
        if not 0 <= self.score <= 1:
            raise ValueError("Prelabel score must be between zero and one")

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.instance_id,
            "class": "seed",
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
            "center_x": self.center_x,
            "center_y": self.center_y,
            "radius": self.radius,
        }


@dataclass(frozen=True)
class PrelabelDiagnostics:
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
class PrelabelResult:
    source: Path
    width: int
    height: int
    producer: PrelabelerDescriptor
    instances: tuple[PrelabelInstance, ...]
    quality: PrelabelQuality
    diagnostics: PrelabelDiagnostics = field(default_factory=PrelabelDiagnostics)

    def __post_init__(self) -> None:
        if (
            isinstance(self.width, bool)
            or not isinstance(self.width, int)
            or self.width <= 0
            or isinstance(self.height, bool)
            or not isinstance(self.height, int)
            or self.height <= 0
        ):
            raise ValueError("Prelabel image dimensions must be positive integers")
        _validate_source(self.source)
        identifiers: set[str] = set()
        for instance in self.instances:
            if instance.instance_id in identifiers:
                raise ValueError(
                    f"Duplicate prelabel instance id: {instance.instance_id}"
                )
            identifiers.add(instance.instance_id)
            if (
                instance.bbox.x + instance.bbox.width > self.width
                or instance.bbox.y + instance.bbox.height > self.height
            ):
                raise ValueError("Prelabel bounding box exceeds image bounds")

    def to_dict(self) -> dict[str, object]:
        document: dict[str, object] = {
            "schema_version": 1,
            "source": self.source.as_posix(),
            "image": {"width": self.width, "height": self.height},
            "producer": self.producer.to_dict(),
            "instances": [instance.to_dict() for instance in self.instances],
            "quality": self.quality.to_dict(),
        }
        diagnostics = self.diagnostics.to_dict()
        if diagnostics:
            document["diagnostics"] = diagnostics
        return document


@dataclass(frozen=True)
class PrelabelFailure:
    source: Path
    producer: PrelabelerDescriptor
    error: str

    def __post_init__(self) -> None:
        _validate_source(self.source)
        if not self.error or len(self.error) > 2000:
            raise ValueError("Prelabel failure error must contain 1 to 2000 characters")

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "source": self.source.as_posix(),
            "producer": self.producer.to_dict(),
            "error": self.error,
        }


class Prelabeler(Protocol):
    """An executable model version that emits the canonical prelabel contract."""

    @property
    def descriptor(self) -> PrelabelerDescriptor: ...

    def predict(self, image_path: Path, source: Path) -> PrelabelResult: ...
