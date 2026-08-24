from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import PipelineConfig


@dataclass(frozen=True)
class FeatureMaps:
    brightness_contrast: np.ndarray
    red_contrast: np.ndarray
    yellow_contrast: np.ndarray
    seed_color_contrast: np.ndarray
    seed_score: np.ndarray
    threshold: float
    foreground_polarity: int
    clipped_fraction: float
    focus_score: float


def _robust_location_scale(
    values: np.ndarray, minimum_scale: float
) -> tuple[float, float]:
    sampled = values[::8]
    median = float(np.median(sampled))
    mad = float(np.median(np.abs(sampled - median)))
    return median, max(minimum_scale, mad * 1.4826)


def compute_feature_maps(
    image: np.ndarray,
    measurement_mask: np.ndarray,
    dish_radius: float,
    config: PipelineConfig,
) -> FeatureMaps:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    input_sigma = max(1.0, dish_radius * config.input_smoothing_fraction)
    smoothed = cv2.GaussianBlur(lab, (0, 0), input_sigma)
    sigma = max(3.0, dish_radius * config.background_sigma_fraction)
    local_background = cv2.GaussianBlur(smoothed, (0, 0), sigma)
    residual = smoothed - local_background

    normalized_channels: list[np.ndarray] = []
    for channel, minimum_scale in enumerate((1.5, 0.6, 0.6)):
        location, scale = _robust_location_scale(
            residual[:, :, channel][measurement_mask], minimum_scale
        )
        normalized_channels.append((residual[:, :, channel] - location) / scale)

    sampled_lightness = lab[:, :, 0][measurement_mask][::8]
    background_lightness = float(np.median(sampled_lightness))
    foreground_polarity = (
        -1 if background_lightness >= config.light_background_threshold else 1
    )

    support_sigma = max(1.5, dish_radius * config.support_sigma_fraction)
    brightness = cv2.GaussianBlur(
        np.maximum(foreground_polarity * normalized_channels[0], 0.0),
        (0, 0),
        support_sigma,
    )
    red = cv2.GaussianBlur(
        np.maximum(normalized_channels[1], 0.0),
        (0, 0),
        support_sigma,
    )
    yellow = cv2.GaussianBlur(
        np.maximum(normalized_channels[2], 0.0),
        (0, 0),
        support_sigma,
    )
    seed_color = np.sqrt(red * yellow)
    score = np.cbrt(brightness * red * yellow)
    score = cv2.GaussianBlur(
        score,
        (0, 0),
        max(1.0, dish_radius * config.score_smoothing_fraction),
    )

    score_values = score[measurement_mask][::8]
    reference = float(np.percentile(score_values, config.score_reference_percentile))
    threshold = max(
        config.minimum_score_threshold,
        reference * config.score_reference_fraction,
    )

    valid_lightness = lab[:, :, 0][measurement_mask]
    clipped_fraction = float(
        np.mean((valid_lightness <= 2.0) | (valid_lightness >= 253.0))
    )
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    focus_values = cv2.Laplacian(gray, cv2.CV_32F)[measurement_mask]

    return FeatureMaps(
        brightness_contrast=brightness,
        red_contrast=red,
        yellow_contrast=yellow,
        seed_color_contrast=seed_color,
        seed_score=score,
        threshold=threshold,
        foreground_polarity=foreground_polarity,
        clipped_fraction=clipped_fraction,
        focus_score=float(np.var(focus_values)),
    )
