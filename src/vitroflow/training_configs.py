from __future__ import annotations

from importlib.resources import files
from pathlib import Path


def default_training_config_root() -> Path:
    source_tree = Path(__file__).resolve().parents[2] / "configs" / "yolo26"
    if source_tree.is_dir():
        return source_tree
    packaged = files("vitroflow").joinpath("resources", "yolo26")
    path = Path(str(packaged))
    if not path.is_dir():
        raise FileNotFoundError("packaged YOLO training configuration is missing")
    return path
