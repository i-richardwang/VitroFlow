"""Loads the model versions a Server assigns, one at a time."""

from __future__ import annotations

import json
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any, Protocol

from .config import PipelineConfig
from .documents import as_digest, as_object, as_string, expect_fields
from .identifiers import VERSION_ID
from .prelabelers import Prelabeler, TraditionalPrelabeler, YoloPrelabeler
from .scoring import DEFAULT_MODEL

ARTIFACT_KINDS = frozenset({"traditional", "ultralytics"})
LOGGER = logging.getLogger(__name__)


class WeightsSource(Protocol):
    def weights(self, version_id: str) -> bytes: ...


def parse_model_version(value: Any, context: str = "model version") -> dict[str, Any]:
    """The manifest fields every model version carries, whatever its kind."""
    manifest = as_object(value, context)
    expect_fields(manifest, {"id", "artifact"}, context)
    version_id = as_string(manifest["id"], f"{context}.id")
    if not VERSION_ID.fullmatch(version_id):
        raise ValueError(f"{context}.id is invalid")
    artifact = as_object(manifest["artifact"], f"{context}.artifact")
    expect_fields(artifact, {"kind", "digest"}, f"{context}.artifact")
    if artifact["kind"] not in ARTIFACT_KINDS:
        raise ValueError(f"{context}.artifact.kind is unsupported")
    as_digest(artifact["digest"], f"{context}.artifact.digest")
    return manifest


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

    def load(self, manifest: dict[str, Any]) -> Prelabeler:
        version_id = manifest["id"]
        if self._loaded and self._loaded[0] == version_id:
            return self._loaded[1]
        self.unload()
        artifact = manifest["artifact"]
        if artifact["kind"] == "ultralytics":
            prelabeler: Prelabeler = YoloPrelabeler.from_run(
                self._yolo_run(version_id, artifact), device=self._device
            )
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

    def _yolo_run(self, version_id: str, artifact: dict[str, Any]) -> Path:
        expected_digest = artifact["digest"]
        expected_bytes = artifact.get("bytes")
        inference = artifact.get("inference")
        validation = artifact.get("validation")
        training = artifact.get("training")
        if (
            not isinstance(expected_bytes, int)
            or not isinstance(inference, dict)
            or not isinstance(validation, dict)
            or not isinstance(training, dict)
        ):
            raise TypeError("Published YOLO artifact manifest is invalid")
        destination = self._artifacts / version_id
        if destination.exists():
            cached = YoloPrelabeler.from_run(destination, device=self._device)
            if cached.artifact_digest != expected_digest:
                raise ValueError(
                    f"Cached YOLO artifact for {version_id} does not match the published version"
                )
            return destination

        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(
            tempfile.mkdtemp(prefix=f".{version_id}.", dir=destination.parent)
        )
        try:
            weights = temporary / "weights" / "best.pt"
            weights.parent.mkdir(parents=True)
            content = self._source.weights(version_id)
            if len(content) != expected_bytes:
                raise ValueError("Downloaded YOLO weights have an unexpected size")
            weights.write_bytes(content)
            (temporary / "inference.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "weights": "weights/best.pt",
                        "inference": {
                            "ready": True,
                            "confidence": inference.get("confidence"),
                            "imgsz": inference.get("imageSize"),
                            "max_det": inference.get("maxDetections"),
                            "end2end": inference.get("endToEnd"),
                        },
                        "validation": validation,
                        "training": {
                            "base_model": training.get("baseModel"),
                            "configuration": training.get("configuration"),
                            "runtime": training.get("runtime"),
                        },
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            downloaded = YoloPrelabeler.from_run(temporary, device=self._device)
            if downloaded.artifact_digest != expected_digest:
                raise ValueError("Downloaded YOLO artifact failed digest verification")
            try:
                temporary.rename(destination)
            except FileExistsError:
                pass
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        return destination
