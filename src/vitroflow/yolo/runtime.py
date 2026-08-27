from __future__ import annotations


def load_yolo() -> type:
    """Load Ultralytics only in processes that train or run YOLO models."""
    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError(
            "Ultralytics is not installed; run `uv sync --extra yolo` first"
        ) from error
    return YOLO
