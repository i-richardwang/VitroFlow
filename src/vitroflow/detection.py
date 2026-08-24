from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import PipelineConfig
from .features import FeatureMaps
from .models import SeedDetection


@dataclass(frozen=True)
class DetectionResult:
    body_mask: np.ndarray
    center_mask: np.ndarray
    labels: np.ndarray
    detections: list[SeedDetection]


def _body_mask(
    features: FeatureMaps,
    measurement_mask: np.ndarray,
    dish_radius: float,
    config: PipelineConfig,
) -> np.ndarray:
    binary = (
        measurement_mask
        & (features.seed_score >= features.threshold * config.body_threshold_fraction)
    ).astype(np.uint8)
    radius = max(1, round(dish_radius * config.morphology_radius_fraction))
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)
    )
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    return binary > 0


def _center_mask(
    features: FeatureMaps,
    measurement_mask: np.ndarray,
    dish_radius: float,
    config: PipelineConfig,
) -> np.ndarray:
    diameter = max(3, round(dish_radius * config.center_distance_fraction))
    if diameter % 2 == 0:
        diameter += 1
    local_maximum = cv2.dilate(
        features.seed_score,
        np.ones((diameter, diameter), dtype=np.uint8),
    )
    centers = (
        measurement_mask
        & (features.seed_score >= features.threshold)
        & (features.seed_score == local_maximum)
    )
    if features.foreground_polarity < 0:
        red_yellow_ratio = features.red_contrast / np.maximum(
            features.yellow_contrast, 1e-6
        )
        centers &= red_yellow_ratio >= config.minimum_light_background_red_yellow_ratio
    return centers


def _partition_bodies(
    body_mask: np.ndarray, center_mask: np.ndarray
) -> tuple[np.ndarray, list[tuple[float, float]]]:
    _, _, _, center_points = cv2.connectedComponentsWithStats(
        center_mask.astype(np.uint8), connectivity=8
    )
    centers = [(float(x), float(y)) for x, y in center_points[1:]]
    if not centers:
        return np.zeros(body_mask.shape, dtype=np.int32), centers

    _, components, stats, _ = cv2.connectedComponentsWithStats(
        body_mask.astype(np.uint8), connectivity=8
    )
    component_centers: dict[int, list[int]] = {}
    for index, (x, y) in enumerate(centers):
        component_id = int(components[round(y), round(x)])
        if component_id > 0:
            component_centers.setdefault(component_id, []).append(index)

    labels = np.zeros(body_mask.shape, dtype=np.int32)
    for component_id, center_indices in component_centers.items():
        x_min, y_min, width, height, _ = (int(value) for value in stats[component_id])
        component_crop = components[y_min : y_min + height, x_min : x_min + width]
        local_y, local_x = np.where(component_crop == component_id)
        y_coordinates = local_y + y_min
        x_coordinates = local_x + x_min
        if len(center_indices) == 1:
            labels[y_coordinates, x_coordinates] = center_indices[0] + 1
            continue

        center_array = np.asarray(
            [centers[index] for index in center_indices], dtype=np.float32
        )
        distances = (x_coordinates[:, None] - center_array[None, :, 0]) ** 2 + (
            y_coordinates[:, None] - center_array[None, :, 1]
        ) ** 2
        nearest = np.argmin(distances, axis=1)
        assigned = np.asarray(center_indices, dtype=np.int32)[nearest] + 1
        labels[y_coordinates, x_coordinates] = assigned
    return labels, centers


def detect_seeds(
    features: FeatureMaps,
    measurement_mask: np.ndarray,
    dish_radius: float,
    config: PipelineConfig,
) -> DetectionResult:
    body_mask = _body_mask(features, measurement_mask, dish_radius, config)
    center_mask = _center_mask(features, measurement_mask, dish_radius, config)
    body_mask |= cv2.dilate(
        center_mask.astype(np.uint8), np.ones((3, 3), np.uint8)
    ).astype(bool)
    partitioned, centers = _partition_bodies(body_mask, center_mask)

    labels = np.zeros_like(partitioned, dtype=np.int32)
    detections: list[SeedDetection] = []
    window_radius = max(3, round(dish_radius * config.label_window_fraction))
    for source_label, (x, y) in enumerate(centers, start=1):
        center_x = round(x)
        center_y = round(y)
        x_min = max(0, center_x - window_radius)
        x_max = min(labels.shape[1], center_x + window_radius + 1)
        y_min = max(0, center_y - window_radius)
        y_max = min(labels.shape[0], center_y + window_radius + 1)
        component = partitioned[y_min:y_max, x_min:x_max] == source_label
        if not np.any(component):
            continue

        detection_id = len(detections) + 1
        labels[y_min:y_max, x_min:x_max][component] = detection_id
        detections.append(
            SeedDetection(
                detection_id=detection_id,
                x=x,
                y=y,
                score=float(features.seed_score[center_y, center_x]),
            )
        )

    return DetectionResult(
        body_mask=body_mask,
        center_mask=center_mask,
        labels=labels,
        detections=detections,
    )
