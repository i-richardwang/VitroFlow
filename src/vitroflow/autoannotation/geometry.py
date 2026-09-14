"""Geometry in source and tile display coordinates."""

from __future__ import annotations


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
