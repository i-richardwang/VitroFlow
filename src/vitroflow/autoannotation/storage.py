"""Local annotation artifact I/O."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from vitroflow.autoannotation.protocol import encoded
from vitroflow.io.files import atomic_file


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected JSON object: {path}")
    return value


def write_json(path: Path, value: dict) -> None:
    with atomic_file(path) as handle:
        handle.write(encoded(value))


def write_image(path: Path, image: np.ndarray) -> None:
    ok, data = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("Unable to encode task image")
    path.write_bytes(data.tobytes())
