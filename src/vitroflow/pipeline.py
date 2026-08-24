from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .config import PipelineConfig
from .detection import detect_seeds
from .features import FeatureMaps, compute_feature_maps
from .geometry import DishGeometry, estimate_geometry
from .models import CountResult, QualityReport
from .rendering import render_debug, render_overlay


def _read_image(path: Path) -> np.ndarray:
    data = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Unable to read image: {path}")
    return image


def _assess_quality(
    geometry: DishGeometry,
    features: FeatureMaps,
    config: PipelineConfig,
) -> QualityReport:
    warnings: list[str] = []
    if geometry.used_fallback:
        warnings.append("dish_detection_failed")
    if features.clipped_fraction > config.maximum_clipped_fraction:
        warnings.append("exposure_clipping")
    if features.focus_score < config.minimum_focus_score:
        warnings.append("low_focus")
    return QualityReport(
        status="review_required" if warnings else "ok",
        warnings=tuple(warnings),
        clipped_fraction=features.clipped_fraction,
        focus_score=features.focus_score,
    )


def count_seeds(path: str | Path, config: PipelineConfig | None = None) -> CountResult:
    source = Path(path)
    config = config or PipelineConfig()
    image = _read_image(source)

    geometry = estimate_geometry(image, config)
    features = compute_feature_maps(
        image,
        geometry.measurement_mask,
        geometry.radius,
        config,
    )
    detection = detect_seeds(
        features,
        geometry.measurement_mask,
        geometry.radius,
        config,
    )

    return CountResult(
        source=source,
        width=image.shape[1],
        height=image.shape[0],
        detections=detection.detections,
        dish_center=geometry.center,
        dish_radius=geometry.radius,
        score_threshold=features.seed_score_threshold,
        quality=_assess_quality(geometry, features, config),
        overlay_bgr=render_overlay(image, geometry, detection),
        debug_bgr=render_debug(image, geometry, features, detection),
        masks={
            "measurement_region": geometry.measurement_mask,
            "bodies": detection.body_mask,
            "centers": detection.center_mask,
            "labels": detection.labels,
        },
        config=config,
    )
