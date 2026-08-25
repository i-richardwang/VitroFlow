from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import PipelineConfig


@dataclass(frozen=True)
class CircleDetection:
    center: tuple[float, float]
    radius: float
    used_fallback: bool


@dataclass(frozen=True)
class DishGeometry:
    center: tuple[float, float]
    radius: float
    dish_mask: np.ndarray
    reference_mask: np.ndarray
    search_mask: np.ndarray
    used_fallback: bool


def circle_mask(
    shape: tuple[int, int], center: tuple[float, float], radius: float
) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.circle(
        mask,
        (round(center[0]), round(center[1])),
        max(1, round(radius)),
        255,
        thickness=-1,
        lineType=cv2.LINE_AA,
    )
    return mask > 0


def detect_dish(image: np.ndarray) -> CircleDetection:
    height, width = image.shape[:2]
    scale = min(1.0, 1200.0 / max(height, width))
    small = cv2.resize(
        image,
        (round(width * scale), round(height * scale)),
        interpolation=cv2.INTER_AREA,
    )
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (0, 0), 3.0)
    sh, sw = gray.shape
    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=min(sh, sw) // 2,
        param1=80,
        param2=45,
        minRadius=int(min(sh, sw) * 0.32),
        maxRadius=int(min(sh, sw) * 0.49),
    )
    if circles is None:
        return CircleDetection(
            center=(width / 2.0, height / 2.0),
            radius=min(width, height) * 0.43,
            used_fallback=True,
        )

    image_center = np.array([sw / 2.0, sh / 2.0])
    best = min(
        circles[0],
        key=lambda candidate: (
            np.linalg.norm(candidate[:2] - image_center) - 0.15 * candidate[2]
        ),
    )
    center_x, center_y, radius = (float(value / scale) for value in best)
    return CircleDetection(
        center=(center_x, center_y),
        radius=radius,
        used_fallback=False,
    )


def estimate_geometry(image: np.ndarray, config: PipelineConfig) -> DishGeometry:
    detection = detect_dish(image)
    shape = image.shape[:2]
    return DishGeometry(
        center=detection.center,
        radius=detection.radius,
        dish_mask=circle_mask(shape, detection.center, detection.radius),
        reference_mask=circle_mask(
            shape,
            detection.center,
            detection.radius * config.geometry.reference_radius_fraction,
        ),
        search_mask=circle_mask(
            shape,
            detection.center,
            detection.radius * config.geometry.search_radius_fraction,
        ),
        used_fallback=detection.used_fallback,
    )
