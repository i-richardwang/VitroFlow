from __future__ import annotations

import hashlib
from pathlib import Path

import cv2
import numpy as np

#: Photographs are stored in one encoding, so a digest names a file outright.
CANONICAL_EXTENSION = ".avif"


def read_image(path: str | Path) -> np.ndarray:
    source = Path(path)
    data = np.fromfile(source, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Unable to read image: {source.name}")
    return image


def content_digest(data: bytes) -> str:
    """The content identity of image bytes: their SHA-256 hex digest."""
    return hashlib.sha256(data).hexdigest()


def verify_digest(data: bytes, digest: str) -> bytes:
    """Return ``data`` once it hashes to ``digest``; raise ``ValueError`` otherwise."""
    if content_digest(data) != digest:
        raise ValueError(f"Content failed digest verification against {digest}")
    return data


def image_digest(path: str | Path) -> str:
    return content_digest(Path(path).read_bytes())
