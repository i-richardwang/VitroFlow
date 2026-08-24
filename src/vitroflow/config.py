from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class PipelineConfig:
    """Dimensionless parameters for seed detection."""

    # Keep labels, reflections, and the dish wall outside the measurement area.
    measurement_radius_fraction: float = 0.60

    # Local appearance normalization and seed evidence.
    input_smoothing_fraction: float = 0.00075
    background_sigma_fraction: float = 0.010
    support_sigma_fraction: float = 0.00125
    score_smoothing_fraction: float = 0.00060
    light_background_threshold: float = 100.0
    score_reference_percentile: float = 99.5
    score_reference_fraction: float = 0.75
    minimum_score_threshold: float = 1.5
    minimum_light_background_red_yellow_ratio: float = 0.02

    # Center detection and label rendering relative to the detected dish.
    center_distance_fraction: float = 0.0075
    body_threshold_fraction: float = 0.35
    label_window_fraction: float = 0.020
    morphology_radius_fraction: float = 0.00055

    # Image quality thresholds.
    maximum_clipped_fraction: float = 0.02
    minimum_focus_score: float = 12.0

    @classmethod
    def from_json(cls, path: str | Path) -> PipelineConfig:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        unknown = set(data).difference(cls.__dataclass_fields__)
        if unknown:
            names = ", ".join(sorted(unknown))
            raise ValueError(f"Unknown configuration field(s): {names}")
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
