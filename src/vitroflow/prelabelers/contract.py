from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from ..annotations import BoundingBox

_VERSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_FINGERPRINT = re.compile(r"^[a-f0-9]{64}$")


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

    def to_dict(self) -> dict[str, object]:
        return {"status": self.status, "warnings": list(self.warnings)}


@dataclass(frozen=True)
class PrelabelInstance:
    instance_id: str
    bbox: BoundingBox
    score: float
    class_name: str = "seed"

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.instance_id,
            "class": self.class_name,
            "bbox": {
                "x": round(self.bbox.x, 2),
                "y": round(self.bbox.y, 2),
                "width": round(self.bbox.width, 2),
                "height": round(self.bbox.height, 2),
            },
            "score": round(self.score, 3),
        }


@dataclass(frozen=True)
class PrelabelResult:
    source: Path
    width: int
    height: int
    producer: PrelabelerDescriptor
    instances: tuple[PrelabelInstance, ...]
    quality: PrelabelQuality
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        document: dict[str, object] = {
            "schema_version": 1,
            "source": self.source.as_posix(),
            "image": {"width": self.width, "height": self.height},
            "producer": self.producer.to_dict(),
            "instances": [instance.to_dict() for instance in self.instances],
            "quality": self.quality.to_dict(),
        }
        if self.diagnostics:
            document["diagnostics"] = self.diagnostics
        return document


class Prelabeler(Protocol):
    """An executable model version that emits the canonical prelabel contract."""

    @property
    def descriptor(self) -> PrelabelerDescriptor: ...

    def predict(self, image_path: Path, source: Path) -> PrelabelResult: ...
