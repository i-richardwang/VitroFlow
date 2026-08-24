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
    body_score_threshold: float = 0.70

    # Seed-center evidence and artifact suppression.
    blob_sigma_fraction: float = 0.005
    line_sigma_fraction: float = 0.015
    seed_score_smoothing_fraction: float = 0.00050
    seed_score_reference_percentile: float = 99.5
    seed_score_reference_fraction: float = 0.65
    minimum_seed_score_threshold: float = 2.0
    minimum_blob_isotropy: float = 0.20
    minimum_body_isotropy: float = 0.005
    maximum_line_coherence: float = 0.70
    large_body_extent_fraction: float = 0.25
    maximum_large_body_line_coherence: float = 0.50

    # Center detection and label rendering relative to the detected dish.
    center_distance_fraction: float = 0.0075
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
