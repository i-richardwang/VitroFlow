from __future__ import annotations

from pathlib import Path

import numpy as np

from .candidates import describe_candidates
from .config import PipelineConfig
from .detection import DetectionResult, detect_seeds
from .geometry import DishGeometry, estimate_geometry
from .image_io import read_image
from .models import CountResult, QualityReport
from .normalization import NormalizedImage, normalize_image
from .proposals import propose_seed_centers
from .regions import render_regions
from .rendering import render_debug, render_overlay
from .scoring import DEFAULT_MODEL, CandidateModel


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
    path: str | Path,
    config: PipelineConfig | None = None,
    model: CandidateModel = DEFAULT_MODEL,
) -> CountResult:
    source = Path(path)
    config = config or PipelineConfig()
    image = read_image(source)

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
    detection = detect_seeds(proposals, evidence, model, config.decision)
    window_radius = max(
        3, round(geometry.radius * config.rendering.region_radius_fraction)
    )
    labels = render_regions(image.shape[:2], detection.detections, window_radius)

    return CountResult(
        source=source,
        width=image.shape[1],
        height=image.shape[0],
        detections=detection.detections,
        dish_center=geometry.center,
        dish_radius=geometry.radius,
        confidence_threshold=config.decision.confidence_threshold,
        model_name=model.name,
        model_fingerprint=model.fingerprint,
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
        config=config,
    )
