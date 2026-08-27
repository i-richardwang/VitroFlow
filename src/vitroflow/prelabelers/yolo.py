from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import numpy as np

from ..annotations import BoundingBox
from ..yolo.runtime import load_yolo
from .contract import (
    PredictionProducer,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
    RuntimeDescriptor,
)


@dataclass(frozen=True)
class YoloInferenceSettings:
    confidence: float
    image_size: int
    max_detections: int
    end_to_end: bool

    def __post_init__(self) -> None:
        if isinstance(self.confidence, bool) or not isinstance(
            self.confidence, (int, float)
        ):
            raise TypeError("YOLO confidence must be a number")
        if not math.isfinite(self.confidence) or not 0 <= self.confidence <= 1:
            raise ValueError("YOLO confidence must be between zero and one")
        for value, name in (
            (self.image_size, "image size"),
            (self.max_detections, "maximum detections"),
        ):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"YOLO {name} must be a positive integer")
        if not isinstance(self.end_to_end, bool):
            raise TypeError("YOLO end_to_end must be a boolean")

    def to_dict(self) -> dict[str, object]:
        return {
            "confidence": self.confidence,
            "imgsz": self.image_size,
            "max_det": self.max_detections,
            "end2end": self.end_to_end,
        }


def _strict_object(value: Any, fields: set[str], context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(f"{context} must be an object")
    unknown = set(value) - fields
    missing = fields - set(value)
    if unknown:
        raise ValueError(f"{context} has unknown {', '.join(sorted(unknown))}")
    if missing:
        raise ValueError(f"{context} is missing {', '.join(sorted(missing))}")
    return value


def load_yolo_inference_settings(run_dir: Path) -> tuple[Path, YoloInferenceSettings]:
    """Read the immutable deployment inputs published by a validated run."""
    summary_path = run_dir.resolve() / "inference.json"
    document = _strict_object(
        json.loads(summary_path.read_text(encoding="utf-8")),
        {"schema_version", "weights", "inference", "validation", "training"},
        "YOLO inference summary",
    )
    if document["schema_version"] != 1:
        raise ValueError("Unsupported YOLO inference summary schema")
    if not isinstance(document["weights"], str) or not document["weights"]:
        raise TypeError("YOLO weights must be a relative path")
    relative_weights = Path(document["weights"])
    if relative_weights.is_absolute() or ".." in relative_weights.parts:
        raise ValueError("YOLO weights must be a relative path within the run")
    weights = (run_dir.resolve() / relative_weights).resolve()
    if run_dir.resolve() not in weights.parents or not weights.is_file():
        raise FileNotFoundError(weights)

    inference = _strict_object(
        document["inference"],
        {"ready", "confidence", "imgsz", "max_det", "end2end"},
        "YOLO inference settings",
    )
    if inference["ready"] is not True:
        raise ValueError("YOLO run is not ready for inference")
    settings = YoloInferenceSettings(
        confidence=inference["confidence"],
        image_size=inference["imgsz"],
        max_detections=inference["max_det"],
        end_to_end=inference["end2end"],
    )
    return weights, settings


def _artifact_digest(weights: Path, settings: YoloInferenceSettings) -> str:
    digest = hashlib.sha256()
    with weights.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    digest.update(b"\0")
    digest.update(
        json.dumps(settings.to_dict(), sort_keys=True, separators=(",", ":")).encode()
    )
    return digest.hexdigest()


def _runtime_fingerprint() -> str:
    digest = hashlib.sha256()
    try:
        ultralytics_version = version("ultralytics")
    except PackageNotFoundError as error:
        raise RuntimeError(
            "Ultralytics is not installed; run `uv sync --extra yolo` first"
        ) from error
    digest.update(b"\0ultralytics\0")
    digest.update(ultralytics_version.encode())
    package = Path(__file__).parent
    for name in ("contract.py", "yolo.py"):
        digest.update(b"\0")
        digest.update(name.encode())
        digest.update(b"\0")
        digest.update((package / name).read_bytes())
    return digest.hexdigest()


@dataclass
class YoloPrelabeler:
    """Runs one validated YOLO training artifact through the shared contract."""

    weights: Path
    settings: YoloInferenceSettings
    device: str | None = None
    _model: Any = field(default=None, init=False, repr=False)
    _runtime: type = field(init=False, repr=False)
    _artifact_digest: str = field(init=False, repr=False)
    _runtime_descriptor: RuntimeDescriptor = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.weights = self.weights.resolve()
        if not self.weights.is_file():
            raise FileNotFoundError(self.weights)
        self._runtime = load_yolo()
        self._artifact_digest = _artifact_digest(self.weights, self.settings)
        self._runtime_descriptor = RuntimeDescriptor(
            adapter="ultralytics",
            fingerprint=_runtime_fingerprint(),
        )

    @classmethod
    def from_run(
        cls,
        run_dir: str | Path,
        *,
        device: str | None = None,
    ) -> YoloPrelabeler:
        run = Path(run_dir).resolve()
        weights, settings = load_yolo_inference_settings(run)
        return cls(
            weights,
            settings,
            device,
        )

    @property
    def artifact_digest(self) -> str:
        return self._artifact_digest

    @property
    def runtime(self) -> RuntimeDescriptor:
        return self._runtime_descriptor

    def _predictor(self) -> Any:
        if self._model is None:
            self._model = self._runtime(str(self.weights))
        return self._model

    def predict(
        self, image_path: Path, digest: str, producer: PredictionProducer
    ) -> PrelabelResult:
        options: dict[str, object] = {
            "source": str(image_path),
            "conf": self.settings.confidence,
            "imgsz": self.settings.image_size,
            "max_det": self.settings.max_detections,
            "end2end": self.settings.end_to_end,
            "classes": [0],
            "verbose": False,
        }
        if self.device is not None:
            options["device"] = self.device
        results = self._predictor().predict(**options)
        if len(results) != 1:
            raise RuntimeError("YOLO must return exactly one result for one image")
        result = results[0]
        height, width = map(int, result.orig_shape)
        instances = []
        if result.boxes is not None:
            rows = np.asarray(result.boxes.data.cpu().numpy())
            if rows.ndim != 2 or rows.shape[1] < 6:
                raise RuntimeError("YOLO returned invalid detection boxes")
            for row in rows:
                x1, y1, x2, y2, score, class_id = map(float, row[:6])
                if int(class_id) != 0:
                    continue
                left = min(max(x1, 0.0), float(width))
                top = min(max(y1, 0.0), float(height))
                right = min(max(x2, 0.0), float(width))
                bottom = min(max(y2, 0.0), float(height))
                if right <= left or bottom <= top:
                    continue
                instances.append(
                    PrelabelInstance(
                        instance_id=str(len(instances)),
                        bbox=BoundingBox(left, top, right - left, bottom - top),
                        score=score,
                    )
                )
        return PrelabelResult(
            digest=digest,
            width=width,
            height=height,
            producer=producer,
            instances=tuple(instances),
            quality=PrelabelQuality("ok"),
        )
