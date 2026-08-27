from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from ..files import write_text_atomically
from .runtime import load_yolo

# Ultralytics keys for what one epoch's validation pass measured.
LOSS_COMPONENTS = ("box", "cls", "dfl")
METRIC_KEYS = {
    "precision": "metrics/precision(B)",
    "recall": "metrics/recall(B)",
    "map50": "metrics/mAP50(B)",
    "map5095": "metrics/mAP50-95(B)",
}


class ValidationMetrics(Protocol):
    results_dict: Mapping[str, float]
    curves_results: Sequence[Sequence[Any]]


@dataclass(frozen=True)
class EpochReport:
    """What Ultralytics knows after one epoch's validation pass."""

    epoch: int
    train: dict[str, float]
    val: dict[str, float]
    precision: float
    recall: float
    map50: float
    map5095: float
    fitness: float
    lr: float

    def to_json(self) -> dict[str, Any]:
        return {
            "epoch": self.epoch,
            "train": dict(self.train),
            "val": dict(self.val),
            "precision": self.precision,
            "recall": self.recall,
            "map50": self.map50,
            "map5095": self.map5095,
            "fitness": self.fitness,
            "lr": self.lr,
        }


@dataclass(frozen=True)
class YoloTrainingResult:
    best_weights: Path
    summary: Path
    metrics: dict[str, float]
    confidence: float | None


class YoloTrainingInterruptedError(RuntimeError):
    pass


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


def _finite(value: Any, name: str) -> float:
    number = float(value)
    if not np.isfinite(number):
        raise ValueError(f"Ultralytics reported a non-finite {name}")
    return number


def _losses(values: Mapping[str, Any], prefix: str) -> dict[str, float]:
    return {
        component: _finite(values[f"{prefix}{component}_loss"], f"{prefix}{component}")
        for component in LOSS_COMPONENTS
    }


def epoch_report(trainer: Any) -> EpochReport:
    """Read one finished epoch from an Ultralytics trainer after validation."""
    metrics = trainer.metrics
    return EpochReport(
        epoch=int(trainer.epoch) + 1,
        train=_losses(trainer.tloss, ""),
        val=_losses(metrics, "val/"),
        precision=_finite(metrics[METRIC_KEYS["precision"]], "precision"),
        recall=_finite(metrics[METRIC_KEYS["recall"]], "recall"),
        map50=_finite(metrics[METRIC_KEYS["map50"]], "mAP50"),
        map5095=_finite(metrics[METRIC_KEYS["map5095"]], "mAP50-95"),
        fitness=_finite(trainer.fitness, "fitness"),
        lr=_finite(trainer.lr["lr/pg0"], "learning rate"),
    )


def _model_source(model: str | Path, weights_dir: Path) -> str:
    source = Path(model)
    if source.parent == Path() and not source.exists():
        weights_dir.mkdir(parents=True, exist_ok=True)
        source = weights_dir / source.name
    return str(source)


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def train_yolo_detector(
    dataset: str | Path,
    output_dir: str | Path,
    *,
    parameters: Mapping[str, Any],
    model: str | Path = "yolo26n.pt",
    model_digest: str,
    runtime_version: str,
    device: str | None = None,
    cancelled: Callable[[], bool] | None = None,
    on_epoch: Callable[[EpochReport], None] | None = None,
) -> YoloTrainingResult:
    """Fine-tune, validate, and publish inference calibration for a YOLO detector.

    `parameters` are the Ultralytics training arguments the run fixes; they are
    recorded verbatim in the published summary.
    """
    data_path = Path(dataset).resolve()
    if not data_path.is_file():
        raise FileNotFoundError(data_path)
    installed_runtime_version = version("ultralytics")
    if installed_runtime_version != runtime_version:
        raise ValueError(
            "Training runtime version differs from the immutable recipe: "
            f"{installed_runtime_version} != {runtime_version}"
        )
    output = Path(output_dir).resolve()
    if output.exists():
        raise FileExistsError(f"Output directory already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    train_options: dict[str, object] = {
        **parameters,
        "data": str(data_path),
        "project": str(output.parent),
        "name": output.name,
        "exist_ok": False,
    }
    if device is not None:
        train_options["device"] = device

    yolo = load_yolo()
    model_source = Path(_model_source(model, output.parent / "weights"))
    trainer_model = yolo(str(model_source))
    if not model_source.is_file() or _file_digest(model_source) != model_digest:
        raise ValueError("Training base model failed digest verification")
    if cancelled:

        def stop_when_cancelled(trainer: Any) -> None:
            if cancelled():
                trainer.stop = True

        trainer_model.add_callback("on_train_batch_end", stop_when_cancelled)
    if on_epoch:

        def report_epoch(trainer: Any) -> None:
            on_epoch(epoch_report(trainer))

        trainer_model.add_callback("on_fit_epoch_end", report_epoch)
    trainer_model.train(**train_options)
    if cancelled and cancelled():
        raise YoloTrainingInterruptedError("training interrupted")
    trainer = trainer_model.trainer
    save_dir = Path(trainer.save_dir)
    best_weights = save_dir / "weights" / "best.pt"
    if not best_weights.is_file():
        raise RuntimeError(f"Training did not produce {best_weights}")

    trained_args = trainer.args
    validator_model = yolo(str(best_weights))
    if cancelled:

        def interrupt_validation(_validator: Any) -> None:
            if cancelled():
                raise YoloTrainingInterruptedError("training interrupted")

        validator_model.add_callback("on_val_batch_end", interrupt_validation)
        if cancelled():
            raise YoloTrainingInterruptedError("training interrupted")
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
    if cancelled and cancelled():
        raise YoloTrainingInterruptedError("training interrupted")
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
        "training": {
            "base_model": {
                "reference": str(model),
                "digest": model_digest,
            },
            "parameters": dict(parameters),
            "runtime": {
                "framework": "ultralytics",
                "version": installed_runtime_version,
            },
        },
    }
    write_text_atomically(summary_path, json.dumps(summary, indent=2) + "\n")
    return YoloTrainingResult(best_weights, summary_path, metric_values, confidence)
