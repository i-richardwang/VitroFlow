from __future__ import annotations

import cv2
import numpy as np

from .detection import DetectionResult
from .features import FeatureMaps
from .geometry import DishGeometry


def _score_preview(score: np.ndarray, mask: np.ndarray) -> np.ndarray:
    values = score[mask]
    low, high = np.percentile(values, (1, 99.5))
    normalized = np.clip((score - low) / max(high - low, 1e-6), 0, 1)
    return cv2.applyColorMap(np.uint8(normalized * 255), cv2.COLORMAP_TURBO)


def render_overlay(
    image: np.ndarray,
    geometry: DishGeometry,
    detection: DetectionResult,
) -> np.ndarray:
    overlay = image.copy()
    labels = detection.labels
    padded = np.pad(labels, 1, mode="constant")
    boundary = (labels > 0) & (
        (labels != padded[:-2, 1:-1])
        | (labels != padded[2:, 1:-1])
        | (labels != padded[1:-1, :-2])
        | (labels != padded[1:-1, 2:])
    )
    boundary = cv2.dilate(boundary.astype(np.uint8), np.ones((3, 3), np.uint8))
    overlay[boundary > 0] = (40, 255, 40)

    region_contours, _ = cv2.findContours(
        geometry.measurement_mask.astype(np.uint8),
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    cv2.drawContours(overlay, region_contours, -1, (255, 180, 0), 3, cv2.LINE_AA)

    font_scale = max(0.35, min(0.65, min(image.shape[:2]) / 6000.0))
    thickness = max(1, round(font_scale * 2))
    for seed in detection.detections:
        point = (round(seed.x), round(seed.y))
        cv2.circle(overlay, point, max(3, thickness + 2), (0, 0, 255), -1)
        cv2.putText(
            overlay,
            str(seed.detection_id),
            (point[0] + 5, point[1] - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (0, 255, 255),
            thickness,
            cv2.LINE_AA,
        )
    return overlay


def render_debug(
    image: np.ndarray,
    geometry: DishGeometry,
    features: FeatureMaps,
    detection: DetectionResult,
) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, 1500.0 / width)
    size = (round(width * scale), round(height * scale))

    region_preview = image.copy()
    region_preview[~geometry.measurement_mask] = (
        region_preview[~geometry.measurement_mask] * 0.20
    ).astype(np.uint8)
    brightness_preview = _score_preview(
        features.brightness_contrast, geometry.measurement_mask
    )
    color_preview = _score_preview(
        features.seed_color_contrast, geometry.measurement_mask
    )
    mask_preview = _score_preview(features.seed_score, geometry.measurement_mask)
    mask_preview[detection.body_mask] = (255, 255, 255)
    mask_preview[detection.labels > 0] = (40, 255, 40)
    mask_preview[detection.center_mask] = (255, 0, 255)

    panels = [
        (region_preview, "measurement region"),
        (brightness_preview, "relative brightness"),
        (color_preview, "relative seed color"),
        (mask_preview, "seed score and detections"),
    ]
    rendered: list[np.ndarray] = []
    for panel, title in panels:
        resized = cv2.resize(panel, size, interpolation=cv2.INTER_AREA)
        cv2.rectangle(resized, (0, 0), (420, 48), (0, 0, 0), -1)
        cv2.putText(
            resized,
            title,
            (12, 34),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.85,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        rendered.append(resized)
    return np.vstack([np.hstack(rendered[:2]), np.hstack(rendered[2:])])
