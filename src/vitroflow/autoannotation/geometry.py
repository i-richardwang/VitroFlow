"""Geometry in source and tile display coordinates."""

from __future__ import annotations

import math

from vitroflow.image_geometry.recipe import DISH_RECIPE as recipe
from vitroflow.image_geometry.recipe import thumbnail_geometry


def dish_coverage(width: int, height: int, circle: dict | None) -> dict | None:
    """An invalid or absent dish circle always keeps full-image coverage."""
    if circle is None:
        return None
    x, y, radius = (circle[key] for key in ("x", "y", "radius"))
    if not all(math.isfinite(value) for value in (x, y, radius)):
        return None
    scale, thumbnail_width, thumbnail_height = thumbnail_geometry(width, height)
    short = min(thumbnail_width, thumbnail_height)
    minimum = (
        math.floor(short * recipe["minRadiusFraction"])
        - recipe["radiusTolerancePixels"]
    ) / scale
    maximum = (
        math.floor(short * recipe["maxRadiusFraction"])
        + recipe["radiusTolerancePixels"]
    ) / scale
    if not (
        0 <= x < width
        and 0 <= y < height
        and 0 < radius
        and minimum <= radius <= maximum
    ):
        return None
    return {"kind": "dish", "circle": circle, "margin": recipe["coverageMargin"]}


def rectangle(box: dict) -> list[float]:
    return [box["x"], box["y"], box["x"] + box["width"], box["y"] + box["height"]]


def box_from_edges(edges: list) -> dict:
    x, y, right, bottom = edges
    return {"x": x, "y": y, "width": right - x, "height": bottom - y}


def clip(edges: list, bounds: list) -> list:
    return [
        max(edges[0], bounds[0]),
        max(edges[1], bounds[1]),
        min(edges[2], bounds[2]),
        min(edges[3], bounds[3]),
    ]


def owned(edges: list, core: list) -> bool:
    x, y = (edges[0] + edges[2]) / 2, (edges[1] + edges[3]) / 2
    return core[0] <= x < core[2] and core[1] <= y < core[3]


def source_edges(item: dict, task: dict) -> list:
    return [
        n / task["displayScale"] + task["patch"][i % 2]
        for i, n in enumerate(rectangle(item["bbox"]))
    ]


def intersects_coverage(rectangle: list, coverage: dict | None) -> bool:
    """Tangencies and crossing cores remain eligible; patches are never clipped."""
    if coverage is None:
        return True
    circle = coverage["circle"]
    x = max(rectangle[0], min(circle["x"], rectangle[2]))
    y = max(rectangle[1], min(circle["y"], rectangle[3]))
    return math.hypot(x - circle["x"], y - circle["y"]) <= circle["radius"] * (
        1 + coverage["margin"]
    )


def planned_regions(
    crop: list[int], settings: dict, coverage: dict | None
) -> list[dict]:
    """Select unchanged cores by conservative coverage; never clip their patches."""
    x, y, width, height = crop
    core_size, halo, scale = (settings[k] for k in ("coreSize", "halo", "displayScale"))
    tasks = []
    for row, top in enumerate(range(y, y + height, core_size)):
        for col, left in enumerate(range(x, x + width, core_size)):
            core = [
                left,
                top,
                min(left + core_size, x + width),
                min(top + core_size, y + height),
            ]
            if not intersects_coverage(core, coverage):
                continue
            patch = [
                max(x, left - halo),
                max(y, top - halo),
                min(x + width, core[2] + halo),
                min(y + height, core[3] + halo),
            ]
            tasks.append(
                {
                    "id": f"tile-{row:03d}-{col:03d}",
                    "core": core,
                    "patch": patch,
                    "displaySize": [
                        (patch[2] - patch[0]) * scale,
                        (patch[3] - patch[1]) * scale,
                    ],
                    "displayScale": scale,
                    "coordinateSpace": "clean.png display pixels",
                }
            )
    return tasks
