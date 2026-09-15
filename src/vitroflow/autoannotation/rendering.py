"""Native-size annotation previews and source-coordinate overlays."""

from __future__ import annotations

from pathlib import Path
from shutil import copyfile

import cv2
import numpy as np

from vitroflow.autoannotation.geometry import rectangle
from vitroflow.autoannotation.protocol import object_digest
from vitroflow.autoannotation.storage import write_image, write_json
from vitroflow.io.files import atomic_directory
from vitroflow.io.image_io import read_image


def references(items: list[dict]) -> list[dict]:
    """Short task-local labels keep reference overlays readable across rounds."""
    return [{**item, "id": f"r{i:03d}"} for i, item in enumerate(items, 1)]


def draw(image: np.ndarray, items: list[dict], *, origin=(0, 0)) -> np.ndarray:
    canvas = image.copy()
    for item in items:
        left, top, right, bottom = [
            round(v - origin[i % 2]) for i, v in enumerate(rectangle(item["bbox"]))
        ]
        cv2.rectangle(canvas, (left, top), (right, bottom), (255, 255, 0), 1)
        cv2.putText(
            canvas,
            item["id"],
            (max(0, left), max(12, top - 3)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (255, 255, 0),
            1,
            cv2.LINE_AA,
        )
    return canvas


def preview(root: Path, task: dict, value: dict, destination: Path) -> dict:
    clean = read_image(root / "tasks" / task["id"] / "clean.png")
    initial = root / "tasks" / task["id"] / "before.png"
    summary = {
        "taskId": task["id"],
        "coordinateSpace": "task clean.png display pixels",
        "displaySize": task["displaySize"],
        "responseDigest": object_digest(value),
        "images": ["clean.png", "proposed.png"],
    }
    with atomic_directory(destination) as working:
        write_image(working / "clean.png", clean)
        write_image(working / "proposed.png", draw(clean, value["instances"]))
        if initial.is_file():
            copyfile(initial, working / "before.png")
            summary["images"].append("before.png")
        write_json(working / "manifest.json", summary)
    return {"output": str(destination), **summary}


def overlay(
    destination: Path, name: str, image: np.ndarray, items: list[dict], origin: tuple
) -> None:
    """Number independently in each image; store the corresponding identity map."""
    numbered = [{**item, "id": str(i)} for i, item in enumerate(items, 1)]
    write_image(destination / f"{name}.png", draw(image, numbered, origin=origin))
    write_json(
        destination / f"{name}-labels.json",
        {str(i): v["id"] for i, v in enumerate(items, 1)},
    )
