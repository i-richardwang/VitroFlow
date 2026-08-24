from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .config import PipelineConfig


@dataclass(frozen=True)
class SeedDetection:
    detection_id: int
    x: float
    y: float
    score: float

    def to_dict(self) -> dict[str, int | float]:
        return {
            "id": self.detection_id,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "score": round(self.score, 3),
        }


@dataclass(frozen=True)
class QualityReport:
    status: str
    warnings: tuple[str, ...]
    clipped_fraction: float
    focus_score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "warnings": list(self.warnings),
            "clipped_fraction": round(self.clipped_fraction, 6),
            "focus_score": round(self.focus_score, 3),
        }


@dataclass(frozen=True)
class CountResult:
    source: Path
    width: int
    height: int
    detections: list[SeedDetection]
    dish_center: tuple[float, float]
    dish_radius: float
    threshold: float
    quality: QualityReport
    overlay_bgr: np.ndarray
    debug_bgr: np.ndarray
    masks: dict[str, np.ndarray]
    config: PipelineConfig

    @property
    def count(self) -> int:
        return len(self.detections)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": str(self.source),
            "image": {"width": self.width, "height": self.height},
            "count": self.count,
            "quality": self.quality.to_dict(),
            "dish": {
                "center_x": round(self.dish_center[0], 2),
                "center_y": round(self.dish_center[1], 2),
                "radius": round(self.dish_radius, 2),
            },
            "score_threshold": round(self.threshold, 4),
            "config": self.config.to_dict(),
            "detections": [seed.to_dict() for seed in self.detections],
        }
