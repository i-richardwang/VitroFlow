"""Coordinate conversion only; does not detect or classify objects."""
import math


def normalize_pixels(box, width, height):
    """Native CLEAN pixel [ymin,xmin,ymax,xmax] -> normalized 0..1000."""
    if width <= 0 or height <= 0:
        raise ValueError("Invalid native CLEAN dimensions")
    y0, x0, y1, x1 = map(float, box)
    if not all(math.isfinite(v) for v in (y0, x0, y1, x1)):
        raise ValueError("Non-finite pixel coordinate")
    if not (0 <= y0 < y1 <= height and 0 <= x0 < x1 <= width):
        raise ValueError("Pixel box outside native CLEAN or empty")
    result = [y0 / height * 1000, x0 / width * 1000,
              y1 / height * 1000, x1 / width * 1000]
    back = [result[0] * height / 1000, result[1] * width / 1000,
            result[2] * height / 1000, result[3] * width / 1000]
    if max(abs(a-b) for a,b in zip(back, (y0,x0,y1,x1))) > 1e-6:
        raise ValueError("Coordinate conversion round trip failed")
    return result
