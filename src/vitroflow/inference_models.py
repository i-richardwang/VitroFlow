"""Validates and loads the immutable model manifests assigned by the Server."""

from __future__ import annotations

import json
import logging
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .config import PipelineConfig
from .documents import (
    as_digest,
    as_integer,
    as_number,
    as_object,
    as_string,
    expect_fields,
    expect_schema_version,
)
from .identifiers import VERSION_ID
from .prelabelers import Prelabeler, TraditionalPrelabeler, YoloPrelabeler
from .scoring import DEFAULT_MODEL
from .training_recipe import parse_training_recipe

MODEL_MANIFEST_SCHEMA_VERSION = 1
CACHE_VALIDATION_ERRORS = (OSError, TypeError, ValueError, RuntimeError)
LOGGER = logging.getLogger(__name__)


class WeightsSource(Protocol):
    def weights(self, version_id: str) -> bytes: ...


def _relative_artifact_path(value: Any, context: str) -> str:
    path = as_string(value, context)
    if path.startswith("/") or "\\" in path or ".." in path.split("/"):
        raise ValueError(f"{context} must be a relative artifact path")
    return path


def _inference_settings(value: Any, context: str) -> None:
    settings = as_object(value, context)
    expect_fields(
        settings,
        {"confidence", "imageSize", "maxDetections", "endToEnd"},
        context,
    )
    confidence = as_number(settings["confidence"], f"{context}.confidence")
    if not 0 <= confidence <= 1:
        raise ValueError(f"{context}.confidence must be between 0 and 1")
    as_integer(settings["imageSize"], f"{context}.imageSize", 1)
    as_integer(settings["maxDetections"], f"{context}.maxDetections", 1)
    if not isinstance(settings["endToEnd"], bool):
        raise TypeError(f"{context}.endToEnd must be a boolean")


def _validation_metrics(value: Any, context: str) -> None:
    metrics = as_object(value, context)
    expect_fields(
        metrics,
        {"precision", "recall", "map50", "map50_95", "fitness"},
        context,
    )
    for name in ("precision", "recall", "map50", "map50_95"):
        metric = as_number(metrics[name], f"{context}.{name}")
        if not 0 <= metric <= 1:
            raise ValueError(f"{context}.{name} must be between 0 and 1")
    as_number(metrics["fitness"], f"{context}.fitness")


def _model_artifact(value: Any, context: str) -> dict[str, Any]:
    artifact = as_object(value, context)
    kind = artifact.get("kind")
    if kind == "traditional":
        expect_fields(artifact, {"kind", "digest"}, context)
    elif kind == "ultralytics":
        expect_fields(
            artifact,
            {
                "kind",
                "digest",
                "bytes",
                "path",
                "inference",
                "validation",
                "training",
            },
            context,
        )
        as_integer(artifact["bytes"], f"{context}.bytes", 1)
        _relative_artifact_path(artifact["path"], f"{context}.path")
        _inference_settings(artifact["inference"], f"{context}.inference")
        _validation_metrics(artifact["validation"], f"{context}.validation")
        parse_training_recipe(artifact["training"], f"{context}.training")
    else:
        raise ValueError(f"{context}.kind is unsupported")
    as_digest(artifact["digest"], f"{context}.digest")
    return artifact


@dataclass(frozen=True)
class ModelManifest:
    """The immutable model identity and artifact an assignment executes."""

    model_version_id: str
    artifact: dict[str, Any]

    @classmethod
    def parse(cls, value: Any, context: str = "model manifest") -> ModelManifest:
        manifest = as_object(value, context)
        expect_fields(
            manifest, {"schemaVersion", "modelVersionId", "artifact"}, context
        )
        expect_schema_version(
            manifest,
            "schemaVersion",
            MODEL_MANIFEST_SCHEMA_VERSION,
            context,
        )
        version_id = as_string(manifest["modelVersionId"], f"{context}.modelVersionId")
        if not VERSION_ID.fullmatch(version_id):
            raise ValueError(f"{context}.modelVersionId is invalid")
        return cls(
            model_version_id=version_id,
            artifact=_model_artifact(manifest["artifact"], f"{context}.artifact"),
        )


def _release_accelerator() -> None:
    try:
        import torch
    except ImportError:
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


class ModelStore:
    """
    Materializes assigned versions into prelabelers. Downloaded YOLO
    artifacts stay on disk under ``model-artifacts/<version>``; only the
    most recently loaded model stays in memory.
    """

    def __init__(self, source: WeightsSource, work_dir: Path, device: str | None):
        self._source = source
        self._artifacts = work_dir / "model-artifacts"
        self._device = device
        self._loaded: tuple[str, Prelabeler] | None = None

    @property
    def loaded(self) -> str | None:
        return self._loaded[0] if self._loaded else None

    def load(self, manifest: ModelManifest) -> Prelabeler:
        version_id = manifest.model_version_id
        if self._loaded and self._loaded[0] == version_id:
            return self._loaded[1]
        self.unload()
        artifact = manifest.artifact
        if artifact["kind"] == "ultralytics":
            prelabeler: Prelabeler = self._yolo_prelabeler(version_id, artifact)
        else:
            prelabeler = TraditionalPrelabeler(PipelineConfig(), DEFAULT_MODEL)
        if prelabeler.artifact_digest != artifact["digest"]:
            raise ValueError(
                f"Local artifact for {version_id} does not match the published digest"
            )
        self._loaded = (version_id, prelabeler)
        LOGGER.info("loaded %s", version_id)
        return prelabeler

    def unload(self) -> None:
        if self._loaded is None:
            return
        _, prelabeler = self._loaded
        self._loaded = None
        del prelabeler
        _release_accelerator()

    def _yolo_prelabeler(
        self, version_id: str, artifact: dict[str, Any]
    ) -> YoloPrelabeler:
        expected_digest = artifact["digest"]
        destination = self._artifacts / version_id
        if destination.exists():
            try:
                return self._verified_yolo_prelabeler(destination, expected_digest)
            except CACHE_VALIDATION_ERRORS as error:
                LOGGER.warning("discarding invalid cache for %s: %s", version_id, error)
                self._discard_cache_entry(destination)

        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(
            tempfile.mkdtemp(prefix=f".{version_id}.", dir=destination.parent)
        )
        try:
            weights = temporary / "weights" / "best.pt"
            weights.parent.mkdir(parents=True)
            content = self._source.weights(version_id)
            if len(content) != artifact["bytes"]:
                raise ValueError("Downloaded YOLO weights have an unexpected size")
            weights.write_bytes(content)
            inference = artifact["inference"]
            training = artifact["training"]
            (temporary / "inference.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "weights": "weights/best.pt",
                        "inference": {
                            "ready": True,
                            "confidence": inference["confidence"],
                            "imgsz": inference["imageSize"],
                            "max_det": inference["maxDetections"],
                            "end2end": inference["endToEnd"],
                        },
                        "validation": artifact["validation"],
                        "training": {
                            "base_model": training["baseModel"],
                            "parameters": training["parameters"],
                            "runtime": training["runtime"],
                        },
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            self._verified_yolo_prelabeler(temporary, expected_digest)
            try:
                temporary.rename(destination)
            except FileExistsError:
                return self._verified_yolo_prelabeler(destination, expected_digest)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        return self._verified_yolo_prelabeler(destination, expected_digest)

    def _verified_yolo_prelabeler(
        self, run: Path, expected_digest: str
    ) -> YoloPrelabeler:
        cached = YoloPrelabeler.from_run(run, device=self._device)
        if cached.artifact_digest != expected_digest:
            raise ValueError("YOLO artifact does not match its published digest")
        return cached

    @staticmethod
    def _discard_cache_entry(path: Path) -> None:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
