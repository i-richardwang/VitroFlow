from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from ..annotations import BoundingBox
from ..config import PipelineConfig
from ..identity import ExecutionIdentity
from ..pipeline import count_seeds
from ..scoring import DEFAULT_MODEL, CandidateModel
from .contract import (
    PrelabelerDescriptor,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
)

_BOX_SIDE_FRACTION = 0.025
_MIN_BOX_SIZE = 2.0


def _execution_fingerprint(execution: ExecutionIdentity) -> str:
    config = json.dumps(
        execution.config.to_dict(),
        sort_keys=True,
        separators=(",", ":"),
    )
    identity = (
        f"{execution.pipeline_fingerprint}\0{execution.model_fingerprint}\0{config}"
    ).encode()
    digest = hashlib.sha256(identity)
    package = Path(__file__).parent
    for name in ("contract.py", "traditional.py"):
        digest.update(b"\0")
        digest.update(name.encode())
        digest.update(b"\0")
        digest.update((package / name).read_bytes())
    return digest.hexdigest()


def _box_around(
    x: float,
    y: float,
    side: float,
    image_width: int,
    image_height: int,
) -> BoundingBox | None:
    left = max(0.0, min(x - side / 2.0, image_width))
    top = max(0.0, min(y - side / 2.0, image_height))
    right = max(0.0, min(x + side / 2.0, image_width))
    bottom = max(0.0, min(y + side / 2.0, image_height))
    width = right - left
    height = bottom - top
    if width < _MIN_BOX_SIZE or height < _MIN_BOX_SIZE:
        return None
    return BoundingBox(left, top, width, height)


@dataclass(frozen=True)
class TraditionalPrelabeler:
    """Adapts the existing candidate pipeline to the canonical box contract."""

    config: PipelineConfig = field(default_factory=PipelineConfig)
    model: CandidateModel = DEFAULT_MODEL

    @property
    def descriptor(self) -> PrelabelerDescriptor:
        execution = ExecutionIdentity.create(self.config, self.model)
        fingerprint = _execution_fingerprint(execution)
        return PrelabelerDescriptor(
            version_id=f"traditional-{fingerprint[:12]}",
            name=execution.model_name,
            kind="traditional",
            fingerprint=fingerprint,
        )

    def predict(self, image_path: Path, source: Path) -> PrelabelResult:
        result = count_seeds(
            image_path,
            source=source,
            config=self.config,
            model=self.model,
        )
        side = result.dish_radius * _BOX_SIDE_FRACTION
        instances = []
        for detection in result.detections:
            bbox = _box_around(
                detection.x,
                detection.y,
                side,
                result.width,
                result.height,
            )
            if bbox is not None:
                instances.append(
                    PrelabelInstance(
                        instance_id=str(detection.detection_id),
                        bbox=bbox,
                        score=detection.score,
                    )
                )
        return PrelabelResult(
            source=result.source,
            width=result.width,
            height=result.height,
            producer=self.descriptor,
            instances=tuple(instances),
            quality=PrelabelQuality(
                status=result.quality.status,
                warnings=result.quality.warnings,
            ),
            diagnostics={
                "dish": {
                    "center_x": round(result.dish_center[0], 2),
                    "center_y": round(result.dish_center[1], 2),
                    "radius": round(result.dish_radius, 2),
                },
                "metrics": {
                    "confidence_threshold": self.config.decision.confidence_threshold,
                    "clipped_fraction": round(result.quality.clipped_fraction, 6),
                    "focus_score": round(result.quality.focus_score, 3),
                },
            },
        )
