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
from ..training_parameters import parse_training_parameters
from .runtime import load_yolo


class BoxValidationMetrics(Protocol):
    mp: float
    mr: float
    map50: float
    map: float
    f1_curve: Sequence[Sequence[float]]
    px: Sequence[float]

    def fitness(self) -> float: ...


class ValidationMetrics(Protocol):
    box: BoxValidationMetrics


@dataclass(frozen=True)
class DetectionLosses:
    """Framework-neutral detection losses exposed by the training protocol."""

    box: float
    classification: float
    regression: float

    def to_json(self) -> dict[str, float]:
        return {
            "box": self.box,
            "classification": self.classification,
            "regression": self.regression,
        }


@dataclass(frozen=True)
class EpochReport:
    """What Ultralytics knows after one epoch's validation pass."""

    epoch: int
    train: DetectionLosses
    val: DetectionLosses
    precision: float
    recall: float
    map50: float
    map50_to_95: float
    fitness: float
    learning_rate: float

    def to_json(self) -> dict[str, Any]:
        return {
            "epoch": self.epoch,
            "train": self.train.to_json(),
            "val": self.val.to_json(),
            "precision": self.precision,
            "recall": self.recall,
            "map50": self.map50,
            "map50To95": self.map50_to_95,
            "fitness": self.fitness,
            "learningRate": self.learning_rate,
        }


@dataclass(frozen=True)
class YoloTrainingResult:
    best_weights: Path
    summary: Path
    metrics: dict[str, float]
    confidence: float | None


class YoloTrainingInterruptedError(RuntimeError):
    pass


def _smooth_curve(values: np.ndarray, fraction: float) -> np.ndarray:
    """Apply the box filter Ultralytics uses when selecting max-F1."""
    width = round(len(values) * fraction * 2) // 2 + 1
    padding = np.ones(width // 2)
    padded = np.concatenate((padding * values[0], values, padding * values[-1]))
    return np.convolve(padded, np.ones(width) / width, mode="valid")


def best_f1_confidence(metrics: ValidationMetrics) -> float | None:
    """Select inference confidence from Ultralytics' public detection curves."""
    confidence = np.asarray(metrics.box.px, dtype=float)
    f1_curve = np.asarray(metrics.box.f1_curve, dtype=float)
    if confidence.size == 0 or f1_curve.size == 0:
        return None
    if (
        confidence.ndim != 1
        or f1_curve.ndim != 2
        or f1_curve.shape[1:] != confidence.shape
    ):
        raise ValueError("Invalid F1-confidence curve returned by Ultralytics")
    if not np.isfinite(confidence).all() or not np.isfinite(f1_curve).all():
        raise ValueError("Non-finite F1-confidence curve returned by Ultralytics")
    mean_f1 = _smooth_curve(f1_curve.mean(axis=0), 0.1)
    index = int(mean_f1.argmax())
    if mean_f1[index] <= 0:
        return None
    value = float(confidence[index])
    if not 0.0 <= value <= 1.0:
        raise ValueError("Confidence returned by Ultralytics is outside [0, 1]")
    return value


def _finite(value: Any, name: str) -> float:
    number = float(value)
    if not np.isfinite(number):
        raise ValueError(f"Ultralytics reported a non-finite {name}")
    return number


def _losses(
    values: Mapping[str, Any], loss_names: Sequence[str], prefix: str
) -> DetectionLosses:
    names = set(loss_names)
    regression_names = names.intersection({"dfl_loss", "l1_loss"})
    if names - {"box_loss", "cls_loss", "dfl_loss", "l1_loss"} or (
        names.intersection({"box_loss", "cls_loss"}) != {"box_loss", "cls_loss"}
        or len(regression_names) != 1
        or len(names) != 3
    ):
        raise ValueError(
            "Ultralytics returned unsupported detection loss components: "
            + ", ".join(sorted(names))
        )
    regression_name = next(iter(regression_names))
    return DetectionLosses(
        box=_finite(values[f"{prefix}box_loss"], f"{prefix}box loss"),
        classification=_finite(
            values[f"{prefix}cls_loss"], f"{prefix}classification loss"
        ),
        regression=_finite(
            values[f"{prefix}{regression_name}"], f"{prefix}regression loss"
        ),
    )


def _validation_summary(metrics: ValidationMetrics) -> dict[str, float]:
    box = metrics.box
    return {
        "precision": _finite(box.mp, "precision"),
        "recall": _finite(box.mr, "recall"),
        "map50": _finite(box.map50, "mAP50"),
        "map50To95": _finite(box.map, "mAP50-95"),
        "fitness": _finite(box.fitness(), "fitness"),
    }


def epoch_report(trainer: Any) -> EpochReport:
    """Read one finished epoch from an Ultralytics trainer after validation."""
    metrics = trainer.validator.metrics
    validation = _validation_summary(metrics)
    loss_names = tuple(trainer.loss_names)
    return EpochReport(
        epoch=int(trainer.epoch) + 1,
        train=_losses(trainer.tloss, loss_names, ""),
        val=_losses(trainer.metrics, loss_names, "val/"),
        precision=validation["precision"],
        recall=validation["recall"],
        map50=validation["map50"],
        map50_to_95=validation["map50To95"],
        fitness=validation["fitness"],
        learning_rate=_finite(trainer.optimizer.param_groups[0]["lr"], "learning rate"),
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
    on_training_start: Callable[[], None] | None = None,
    on_epoch: Callable[[EpochReport], None] | None = None,
    on_validation_start: Callable[[], None] | None = None,
) -> YoloTrainingResult:
    """Fine-tune, validate, and publish inference calibration for a YOLO detector.

    `parameters` are the Ultralytics training arguments the run fixes; they are
    recorded verbatim in the published summary.
    """
    fixed_parameters = parse_training_parameters(parameters)
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
        **fixed_parameters,
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

        trainer_model.add_callback("on_model_save", report_epoch)
    if on_training_start:
        on_training_start()
    trainer_model.train(**train_options)
    if cancelled and cancelled():
        raise YoloTrainingInterruptedError("training interrupted")
    trainer = trainer_model.trainer
    save_dir = Path(trainer.save_dir)
    best_weights = Path(trainer.best)
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
    if on_validation_start:
        on_validation_start()
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
    metric_values = _validation_summary(metrics)

    summary_path = save_dir / "inference.json"
    summary = {
        "schemaVersion": 1,
        "weights": best_weights.relative_to(save_dir).as_posix(),
        "inference": {
            "ready": confidence is not None,
            "confidence": confidence,
            "imageSize": trained_args.imgsz,
            "maxDetections": trained_args.max_det,
            "endToEnd": False,
        },
        "validation": metric_values,
        "training": {
            "baseModel": {
                "reference": str(model),
                "digest": model_digest,
            },
            "parameters": fixed_parameters,
            "runtime": {
                "framework": "ultralytics",
                "version": installed_runtime_version,
            },
        },
    }
    write_text_atomically(summary_path, json.dumps(summary, indent=2) + "\n")
    return YoloTrainingResult(best_weights, summary_path, metric_values, confidence)
