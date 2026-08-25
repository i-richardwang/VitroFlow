from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

PIPELINE_NAME = "vitroflow-seed-counting"

_PIPELINE_FILES = (
    "artifacts.py",
    "candidates.py",
    "config.py",
    "detection.py",
    "geometry.py",
    "image_io.py",
    "identity.py",
    "models.py",
    "normalization.py",
    "pipeline.py",
    "proposals.py",
    "regions.py",
    "rendering.py",
    "scoring.py",
)


@lru_cache(maxsize=1)
def pipeline_fingerprint() -> str:
    package_dir = Path(__file__).parent
    digest = hashlib.sha256()
    for name in _PIPELINE_FILES:
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update((package_dir / name).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()
