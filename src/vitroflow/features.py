from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import PipelineConfig


@dataclass(frozen=True)
class FeatureMaps:
    brightness_contrast: np.ndarray
    seed_color_contrast: np.ndarray
    blob_isotropy: np.ndarray
    line_coherence: np.ndarray
    body_score: np.ndarray
    seed_score: np.ndarray
    seed_score_threshold: float
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

    support_sigma = max(1.5, dish_radius * config.support_sigma_fraction)
    brightness = cv2.GaussianBlur(
        np.abs(normalized_channels[0]),
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
    seed_color = np.maximum(red, yellow)
    body_score = np.sqrt(brightness * seed_color)

    # The Hessian determinant is positive at compact two-dimensional extrema and
    # near zero along long edges. The eigenvalue ratio is scale-free.
    blob_sigma = max(2.0, dish_radius * config.blob_sigma_fraction)
    blob_lightness = cv2.GaussianBlur(normalized_channels[0], (0, 0), blob_sigma)
    derivative_scale = blob_sigma**2 / 4.0
    dxx = cv2.Sobel(blob_lightness, cv2.CV_32F, 2, 0, ksize=3, scale=derivative_scale)
    dyy = cv2.Sobel(blob_lightness, cv2.CV_32F, 0, 2, ksize=3, scale=derivative_scale)
    dxy = cv2.Sobel(blob_lightness, cv2.CV_32F, 1, 1, ksize=3, scale=derivative_scale)
    determinant = dxx * dyy - dxy * dxy
    blob_response = np.sqrt(np.maximum(determinant, 0.0))

    discriminant = np.sqrt(np.maximum((dxx - dyy) ** 2 + 4.0 * dxy**2, 0.0))
    first_eigenvalue = (dxx + dyy + discriminant) * 0.5
    second_eigenvalue = (dxx + dyy - discriminant) * 0.5
    maximum_magnitude = np.maximum(np.abs(first_eigenvalue), np.abs(second_eigenvalue))
    blob_isotropy = np.minimum(
        np.abs(first_eigenvalue), np.abs(second_eigenvalue)
    ) / np.maximum(maximum_magnitude, 1e-6)

    gradient_x = cv2.Sobel(blob_lightness, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(blob_lightness, cv2.CV_32F, 0, 1, ksize=3)
    line_sigma = max(blob_sigma, dish_radius * config.line_sigma_fraction)
    gradient_xx = cv2.GaussianBlur(gradient_x * gradient_x, (0, 0), line_sigma)
    gradient_yy = cv2.GaussianBlur(gradient_y * gradient_y, (0, 0), line_sigma)
    gradient_xy = cv2.GaussianBlur(gradient_x * gradient_y, (0, 0), line_sigma)
    line_coherence = np.sqrt(
        (gradient_xx - gradient_yy) ** 2 + 4.0 * gradient_xy**2
    ) / np.maximum(gradient_xx + gradient_yy, 1e-6)

    score = np.cbrt(brightness * seed_color * blob_response)
    score = cv2.GaussianBlur(
        score,
        (0, 0),
        max(1.0, dish_radius * config.seed_score_smoothing_fraction),
    )

    score_values = score[measurement_mask][::8]
    reference = float(
        np.percentile(score_values, config.seed_score_reference_percentile)
    )
    seed_score_threshold = max(
        config.minimum_seed_score_threshold,
        reference * config.seed_score_reference_fraction,
    )

    valid_lightness = lab[:, :, 0][measurement_mask]
    clipped_fraction = float(
        np.mean((valid_lightness <= 2.0) | (valid_lightness >= 253.0))
    )
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    focus_values = cv2.Laplacian(gray, cv2.CV_32F)[measurement_mask]

    return FeatureMaps(
        brightness_contrast=brightness,
        seed_color_contrast=seed_color,
        blob_isotropy=blob_isotropy,
        line_coherence=line_coherence,
        body_score=body_score,
        seed_score=score,
        seed_score_threshold=seed_score_threshold,
        clipped_fraction=clipped_fraction,
        focus_score=float(np.var(focus_values)),
    )
