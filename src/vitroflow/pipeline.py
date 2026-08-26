from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .candidates import CandidateEvidence, describe_candidates
from .config import PipelineConfig
from .detection import DetectionResult, detect_seeds
from .geometry import DishGeometry, estimate_geometry
from .identity import ExecutionIdentity
from .image_io import read_image
from .models import CountResult, QualityReport
from .normalization import NormalizedImage, normalize_image
from .proposals import SeedProposal, propose_seed_centers
from .regions import render_regions
from .rendering import render_debug, render_overlay
from .scoring import DEFAULT_MODEL, CandidateModel


@dataclass(frozen=True)
class CandidateAnalysis:
    image: np.ndarray
    geometry: DishGeometry
    normalized: NormalizedImage
    proposals: list[SeedProposal]
    evidence: list[CandidateEvidence]


def analyze_candidates(
    path: str | Path,
    config: PipelineConfig | None = None,
) -> CandidateAnalysis:
    config = config or PipelineConfig()
    image = read_image(path)
    geometry = estimate_geometry(image, config)
    normalized = normalize_image(image, geometry.reference_mask, geometry.radius)
    proposals = propose_seed_centers(
        normalized,
        geometry.reference_mask,
        geometry.search_mask,
        geometry.radius,
        config.proposals,
    )
    evidence = describe_candidates(
        normalized,
        proposals,
        geometry.center,
        geometry.radius,
    )
    return CandidateAnalysis(
        image=image,
        geometry=geometry,
        normalized=normalized,
        proposals=proposals,
        evidence=evidence,
    )


def _assess_quality(
    geometry: DishGeometry,
    normalized: NormalizedImage,
    config: PipelineConfig,
) -> QualityReport:
    warnings: list[str] = []
    if geometry.used_fallback:
        warnings.append("dish_detection_failed")
    if normalized.clipped_fraction > config.quality.maximum_clipped_fraction:
        warnings.append("exposure_clipping")
    if normalized.focus_score < config.quality.minimum_focus_score:
        warnings.append("low_focus")
    return QualityReport(
        status="review_required" if warnings else "ok",
        warnings=tuple(warnings),
        clipped_fraction=normalized.clipped_fraction,
        focus_score=normalized.focus_score,
    )


def _center_mask(shape: tuple[int, int], detection: DetectionResult) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    for seed in detection.detections:
        mask[round(seed.y), round(seed.x)] = True
    return mask


def count_seeds(
    image_path: str | Path,
    *,
    source: str | Path | None = None,
    config: PipelineConfig | None = None,
    model: CandidateModel = DEFAULT_MODEL,
) -> CountResult:
    config = config or PipelineConfig()
    analysis = analyze_candidates(image_path, config)
    image = analysis.image
    geometry = analysis.geometry
    normalized = analysis.normalized
    detection = detect_seeds(
        analysis.proposals,
        analysis.evidence,
        model,
        config.decision,
    )
    window_radius = max(
        3, round(geometry.radius * config.rendering.region_radius_fraction)
    )
    labels = render_regions(image.shape[:2], detection.detections, window_radius)

    return CountResult(
        source=Path(source) if source is not None else Path(image_path),
        width=image.shape[1],
        height=image.shape[0],
        detections=detection.detections,
        dish_center=geometry.center,
        dish_radius=geometry.radius,
        execution=ExecutionIdentity.create(config, model),
        quality=_assess_quality(geometry, normalized, config),
        overlay_bgr=render_overlay(image, geometry, detection, labels),
        debug_bgr=render_debug(image, geometry, normalized, detection, labels),
        masks={
            "dish": geometry.dish_mask,
            "reference_region": geometry.reference_mask,
            "search_region": geometry.search_mask,
            "centers": _center_mask(image.shape[:2], detection),
            "regions": labels,
        },
    )
