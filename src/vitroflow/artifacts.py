from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .config import PipelineConfig
from .models import CountResult
from .pipeline import count_seeds
from .scoring import DEFAULT_MODEL, CandidateModel


@dataclass(frozen=True)
class ImageArtifacts:
    result: CountResult
    result_json: bytes
    overlay_jpeg: bytes
    debug_jpeg: bytes


def _encode_jpeg(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image)
    if not ok:
        raise ValueError("Unable to encode result image")
    return encoded.tobytes()


def create_image_artifacts(
    image_path: str | Path,
    source: str | Path,
    *,
    config: PipelineConfig | None = None,
    model: CandidateModel = DEFAULT_MODEL,
) -> ImageArtifacts:
    result = count_seeds(
        image_path,
        source=source,
        config=config,
        model=model,
    )
    result_json = (
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    return ImageArtifacts(
        result=result,
        result_json=result_json,
        overlay_jpeg=_encode_jpeg(result.overlay_bgr),
        debug_jpeg=_encode_jpeg(result.debug_bgr),
    )


def write_image_artifacts(artifacts: ImageArtifacts, output_dir: str | Path) -> None:
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    stem = artifacts.result.source.stem
    (destination / f"{stem}.json").write_bytes(artifacts.result_json)
    (destination / f"{stem}_overlay.jpg").write_bytes(artifacts.overlay_jpeg)
    (destination / f"{stem}_debug.jpg").write_bytes(artifacts.debug_jpeg)
