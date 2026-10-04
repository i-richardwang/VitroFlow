"""Locate the culture dish so that matching and focus stay on its contents."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

THUMBNAIL_LONG_EDGE = 1200
SMOOTHING_SIGMA = 3.0
ACCUMULATOR_RESOLUTION = 1.2
EDGE_THRESHOLD = 80
CENTRE_THRESHOLD = 45
# A dish photographed from above fills most of the shorter side, and may
# overflow it slightly when the camera is close.
MIN_RADIUS_FRACTION = 0.32
MAX_RADIUS_FRACTION = 0.6
RADIUS_PREFERENCE = 0.15


@dataclass(frozen=True)
class DishCircle:
    x: float
    y: float
    radius: float


def locate_dish(gray: np.ndarray) -> DishCircle | None:
    height, width = gray.shape
    scale = min(1.0, THUMBNAIL_LONG_EDGE / max(width, height))
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), SMOOTHING_SIGMA)
    side = min(small.shape)
    circles = cv2.HoughCircles(
        small,
        cv2.HOUGH_GRADIENT,
        dp=ACCUMULATOR_RESOLUTION,
        minDist=side // 2,
        param1=EDGE_THRESHOLD,
        param2=CENTRE_THRESHOLD,
        minRadius=int(side * MIN_RADIUS_FRACTION),
        maxRadius=int(side * MAX_RADIUS_FRACTION),
    )
    if circles is None:
        return None
    # The dish is the large circle near the middle of the frame.
    centre = np.array([small.shape[1] / 2.0, small.shape[0] / 2.0])
    x, y, radius = min(
        circles[0],
        key=lambda c: np.linalg.norm(c[:2] - centre) - RADIUS_PREFERENCE * c[2],
    )
    return DishCircle(
        x=float(x / scale), y=float(y / scale), radius=float(radius / scale)
    )
