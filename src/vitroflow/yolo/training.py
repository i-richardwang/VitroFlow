from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from ..files import write_text_atomically


class ValidationMetrics(Protocol):
    results_dict: Mapping[str, float]
    curves_results: Sequence[Sequence[Any]]


@dataclass(frozen=True)
class YoloTrainingResult:
    best_weights: Path
    summary: Path
    metrics: dict[str, float]
    confidence: float | None


def best_f1_confidence(metrics: ValidationMetrics) -> float | None:
    """Select inference confidence from Ultralytics' public F1 curve."""
    for x_values, y_values, x_label, y_label in metrics.curves_results:
        if x_label == "Confidence" and y_label == "F1":
            confidence = np.asarray(x_values)
            mean_f1 = np.asarray(y_values).mean(axis=0)
            if confidence.ndim != 1 or mean_f1.shape != confidence.shape:
                raise ValueError("Invalid F1-confidence curve returned by Ultralytics")
            if not np.isfinite(confidence).all() or not np.isfinite(mean_f1).all():
                raise ValueError(
                    "Non-finite F1-confidence curve returned by Ultralytics"
                )
            index = int(mean_f1.argmax())
            if mean_f1[index] <= 0:
                return None
            value = float(confidence[index])
            if not 0.0 <= value <= 1.0:
                raise ValueError("Confidence returned by Ultralytics is outside [0, 1]")
            return value
    raise ValueError("Ultralytics validation did not produce an F1-confidence curve")


def _load_yolo() -> type:
    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError(
            "Ultralytics is not installed; run `uv sync --group train` first"
        ) from error
    return YOLO


def _model_source(model: str | Path, weights_dir: Path) -> str:
    source = Path(model)
    if source.parent == Path() and not source.exists():
        weights_dir.mkdir(parents=True, exist_ok=True)
        source = weights_dir / source.name
    return str(source)


def _positive_override(value: int | None, name: str) -> int | None:
    if value is not None and value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def train_yolo_detector(
    dataset: str | Path,
    output_dir: str | Path,
    *,
    config: str | Path,
    model: str | Path = "yolo26n.pt",
    device: str | None = None,
    epochs: int | None = None,
    image_size: int | None = None,
    batch_size: int | None = None,
) -> YoloTrainingResult:
    """Fine-tune, validate, and publish inference calibration for a YOLO detector."""
    data_path = Path(dataset).resolve()
    if not data_path.is_file():
        raise FileNotFoundError(data_path)
    config_path = Path(config).resolve()
    if not config_path.is_file():
        raise FileNotFoundError(config_path)
    output = Path(output_dir).resolve()
    if output.exists():
        raise FileExistsError(f"Output directory already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    overrides = {
        "epochs": _positive_override(epochs, "epochs"),
        "imgsz": _positive_override(image_size, "image_size"),
        "batch": _positive_override(batch_size, "batch_size"),
    }
    train_options: dict[str, object] = {
        "cfg": str(config_path),
        "data": str(data_path),
        "project": str(output.parent),
        "name": output.name,
        "exist_ok": False,
    }
    train_options.update({key: value for key, value in overrides.items() if value})
    if device is not None:
        train_options["device"] = device

    yolo = _load_yolo()
    trainer_model = yolo(_model_source(model, output.parent / "weights"))
    trainer_model.train(**train_options)
    trainer = trainer_model.trainer
    save_dir = Path(trainer.save_dir)
    best_weights = save_dir / "weights" / "best.pt"
    if not best_weights.is_file():
        raise RuntimeError(f"Training did not produce {best_weights}")

    trained_args = trainer.args
    validator_model = yolo(str(best_weights))
    metrics = validator_model.val(
        data=str(data_path),
        imgsz=trained_args.imgsz,
        max_det=trained_args.max_det,
        end2end=False,
        device=trained_args.device,
        project=str(save_dir),
        name="validation-one-to-many",
        exist_ok=False,
    )
    confidence = best_f1_confidence(metrics)
    metric_values = {key: float(value) for key, value in metrics.results_dict.items()}

    summary_path = save_dir / "inference.json"
    summary = {
        "schema_version": 1,
        "weights": best_weights.relative_to(save_dir).as_posix(),
        "inference": {
            "ready": confidence is not None,
            "confidence": confidence,
            "imgsz": trained_args.imgsz,
            "max_det": trained_args.max_det,
            "end2end": False,
        },
        "validation": metric_values,
    }
    write_text_atomically(summary_path, json.dumps(summary, indent=2) + "\n")
    return YoloTrainingResult(best_weights, summary_path, metric_values, confidence)
