"""Validates and loads the immutable model manifests assigned by the Server."""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from vitroflow.contracts.validation import validate_wire_contract
from vitroflow.detectors.contract import Detector
from vitroflow.detectors.traditional.config import PipelineConfig
from vitroflow.detectors.traditional.detector import TraditionalDetector
from vitroflow.detectors.traditional.scoring import DEFAULT_MODEL
from vitroflow.detectors.ultralytics.detector import UltralyticsDetector
from vitroflow.detectors.ultralytics.runtime import release_accelerator

CACHE_VALIDATION_ERRORS = (OSError, TypeError, ValueError, RuntimeError)
LOGGER = logging.getLogger(__name__)


class WeightsSource(Protocol):
    def weights(self, version_id: str) -> bytes: ...


@dataclass(frozen=True)
class ModelManifest:
    """The immutable model identity and artifact an assignment executes."""

    model_version_id: str
    classes: tuple[str, ...]
    artifact: dict[str, Any]

    @classmethod
    def parse(cls, value: Any, context: str = "model manifest") -> ModelManifest:
        validate_wire_contract("inference-model-manifest", value, context)
        return cls(
            model_version_id=value["modelVersionId"],
            classes=tuple(value["classes"]),
            artifact=value["artifact"],
        )


class ModelStore:
    """
    Materializes assigned versions into detectors. Downloaded YOLO
    artifacts stay on disk under ``model-artifacts/<version>``; only the
    most recently loaded model stays in memory.
    """

    def __init__(self, source: WeightsSource, work_dir: Path, device: str | None):
        self._source = source
        self._artifacts = work_dir / "model-artifacts"
        self._device = device
        self._loaded: tuple[str, Detector] | None = None

    def load(self, manifest: ModelManifest) -> Detector:
        version_id = manifest.model_version_id
        if self._loaded and self._loaded[0] == version_id:
            return self._loaded[1]
        self.unload()
        artifact = manifest.artifact
        if artifact["kind"] == "ultralytics":
            detector: Detector = self._ultralytics_detector(
                version_id, manifest.classes, artifact
            )
        else:
            if manifest.classes != ("seed",):
                raise ValueError("Traditional detector only executes the seed class")
            detector = TraditionalDetector(PipelineConfig(), DEFAULT_MODEL)
        if detector.artifact_digest != artifact["digest"]:
            raise ValueError(
                f"Local artifact for {version_id} does not match the published digest"
            )
        self._loaded = (version_id, detector)
        LOGGER.info("loaded %s", version_id)
        return detector

    def unload(self) -> None:
        if self._loaded is None:
            return
        _, detector = self._loaded
        self._loaded = None
        del detector
        release_accelerator()

    def _ultralytics_detector(
        self, version_id: str, classes: tuple[str, ...], artifact: dict[str, Any]
    ) -> UltralyticsDetector:
        expected_digest = artifact["digest"]
        destination = self._artifacts / version_id
        if destination.exists():
            try:
                return self._verified_ultralytics_detector(
                    destination, classes, expected_digest
                )
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
            if len(content) != artifact["weights"]["bytes"]:
                raise ValueError("Downloaded YOLO weights have an unexpected size")
            if hashlib.sha256(content).hexdigest() != artifact["weights"]["digest"]:
                raise ValueError("Downloaded YOLO weights have an unexpected digest")
            weights.write_bytes(content)
            inference = artifact["inference"]
            training = artifact["training"]
            (temporary / "inference.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "weights": "weights/best.pt",
                        "inference": {
                            "ready": True,
                            "confidence": inference["confidence"],
                            "imageSize": inference["imageSize"],
                            "maxDetections": inference["maxDetections"],
                            "endToEnd": inference["endToEnd"],
                        },
                        "validation": artifact["validation"],
                        "training": {
                            "baseModel": training["baseModel"],
                            "parameters": training["parameters"],
                            "runtime": training["runtime"],
                        },
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            self._verified_ultralytics_detector(temporary, classes, expected_digest)
            try:
                temporary.rename(destination)
            except FileExistsError:
                return self._verified_ultralytics_detector(
                    destination, classes, expected_digest
                )
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        return self._verified_ultralytics_detector(
            destination, classes, expected_digest
        )

    def _verified_ultralytics_detector(
        self, run: Path, classes: tuple[str, ...], expected_digest: str
    ) -> UltralyticsDetector:
        cached = UltralyticsDetector.from_run(run, classes, device=self._device)
        if cached.artifact_digest != expected_digest:
            raise ValueError("YOLO artifact does not match its published digest")
        return cached

    @staticmethod
    def _discard_cache_entry(path: Path) -> None:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
