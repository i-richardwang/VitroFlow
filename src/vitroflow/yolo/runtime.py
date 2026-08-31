from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version


def ultralytics_installed() -> bool:
    try:
        version("ultralytics")
    except PackageNotFoundError:
        return False
    return True


def load_yolo() -> type:
    if not ultralytics_installed():
        raise RuntimeError(
            "Ultralytics is not installed; run `uv sync --extra yolo` first"
        )
    try:
        from ultralytics import YOLO
    except Exception as error:
        raise RuntimeError("Ultralytics is installed but cannot be imported") from error
    return YOLO
