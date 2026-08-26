from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ..annotations import BoundingBox
from .dataset import DatasetImage, YoloDatasetManifest, export_dataset_images

_BOX_SIDE_DISH_FRACTION = 0.025
_MINIMUM_BOX_EDGE = 2.0


def _object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(f"{context} must be an object")
    return value


def _positive_integer(value: Any, context: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{context} must be a positive integer")
    return value


def _number(value: Any, context: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{context} must be a number")
    number = float(value)
    if not math.isfinite(number) or (positive and number <= 0):
        qualifier = "a finite positive number" if positive else "finite"
        raise ValueError(f"{context} must be {qualifier}")
    return number


def _centered_box(
    x: float, y: float, side: float, image_width: int, image_height: int
) -> BoundingBox | None:
    left = min(max(x - side / 2.0, 0.0), float(image_width))
    top = min(max(y - side / 2.0, 0.0), float(image_height))
    right = min(max(x + side / 2.0, 0.0), float(image_width))
    bottom = min(max(y + side / 2.0, 0.0), float(image_height))
    width = right - left
    height = bottom - top
    if width < _MINIMUM_BOX_EDGE or height < _MINIMUM_BOX_EDGE:
        return None
    return BoundingBox(left, top, width, height)


def _load_prelabel(path: Path) -> DatasetImage:
    payload = _object(json.loads(path.read_text(encoding="utf-8")), str(path))
    source_value = payload.get("source")
    if not isinstance(source_value, str) or not source_value:
        raise ValueError(f"{path}.source must be a non-empty string")

    image = _object(payload.get("image"), f"{path}.image")
    width = _positive_integer(image.get("width"), f"{path}.image.width")
    height = _positive_integer(image.get("height"), f"{path}.image.height")
    dish = _object(payload.get("dish"), f"{path}.dish")
    radius = _number(dish.get("radius"), f"{path}.dish.radius", positive=True)

    detections = payload.get("detections")
    if not isinstance(detections, list):
        raise TypeError(f"{path}.detections must be an array")
    count = payload.get("count")
    if (
        isinstance(count, bool)
        or not isinstance(count, int)
        or count != len(detections)
    ):
        raise ValueError(f"{path}.count must match the number of detections")

    side = radius * _BOX_SIDE_DISH_FRACTION
    boxes: list[BoundingBox] = []
    for index, raw_detection in enumerate(detections):
        context = f"{path}.detections[{index}]"
        detection = _object(raw_detection, context)
        x = _number(detection.get("x"), f"{context}.x")
        y = _number(detection.get("y"), f"{context}.y")
        box = _centered_box(x, y, side, width, height)
        if box is not None:
            boxes.append(box)

    return DatasetImage(Path(source_value), width, height, tuple(boxes))


def _is_failure(path: Path) -> bool:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return isinstance(payload, dict) and "error" in payload


def export_prelabel_yolo_dataset(
    prelabels_dir: str | Path,
    data_root: str | Path,
    output_dir: str | Path,
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> YoloDatasetManifest:
    """Adapt a dataset's prelabels into a temporary YOLO dataset.

    Failure documents are skipped; only detector results become training targets.
    """
    directory = Path(prelabels_dir)
    if not directory.is_dir():
        raise FileNotFoundError(directory)
    prelabel_paths = [
        path for path in sorted(directory.glob("*.json")) if not _is_failure(path)
    ]
    if len(prelabel_paths) < 2:
        raise ValueError("Prelabel YOLO export requires at least two prelabels")
    images = [_load_prelabel(path) for path in prelabel_paths]
    return export_dataset_images(
        images,
        data_root,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
    )
