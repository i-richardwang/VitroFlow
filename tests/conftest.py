"""Builders for the workbench documents the tests exchange with the Python side."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from vitroflow.manifest import MANIFEST_SCHEMA_VERSION, blob_path, manifest_path

SOURCE = {
    "modelVersionId": "set.traditional-v1",
    "artifactDigest": "a" * 64,
    "runtime": {"adapter": "traditional", "fingerprint": "b" * 64},
}


def annotation_document(
    digest: str,
    boxes: list[dict[str, float]] | None = None,
    *,
    status: str = "complete",
    revision: int = 1,
    width: int = 100,
    height: int = 80,
) -> dict[str, Any]:
    if boxes is None:
        boxes = [{"x": 10, "y": 20, "width": 8, "height": 6}]
    return {
        "schemaVersion": 1,
        "image": {"digest": digest, "width": width, "height": height},
        "source": SOURCE,
        "status": status,
        "revision": revision,
        "instances": [
            {"id": f"seed-{index + 1}", "class": "seed", "bbox": box}
            for index, box in enumerate(boxes)
        ],
    }


def prelabel_document(
    digest: str, *, width: int = 1000, height: int = 800
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "image": {"digest": digest, "width": width, "height": height},
        "producer": {
            "model_version_id": "set.traditional-v1",
            "artifact_digest": "a" * 64,
            "runtime": {"adapter": "traditional", "fingerprint": "b" * 64},
        },
        "instances": [
            {
                "id": "1",
                "class": "seed",
                "bbox": {"x": 96.25, "y": 196.25, "width": 7.5, "height": 7.5},
                "score": 0.9,
            }
        ],
        "quality": {"status": "ok", "warnings": []},
    }


def manifest_entry(
    digest: str,
    *,
    extension: str = ".jpg",
    size: int = 1,
    split: str | None = None,
    prelabel: dict[str, Any] | None = None,
    label: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "digest": digest,
        "extension": extension,
        "filename": f"{digest[:4]}{extension}",
        "bytes": size,
        "split": split,
        "prelabel": prelabel,
        "label": label,
    }


def manifest_document(dataset: str, images: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "dataset": dataset,
        "images": images,
    }


def write_manifest(data_root: Path, dataset: str, images: list[dict[str, Any]]) -> Path:
    path = manifest_path(data_root, dataset)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest_document(dataset, images)), encoding="utf-8")
    return path


def encoded_image(width: int = 100, height: int = 80, variant: int = 0) -> bytes:
    """JPEG bytes of a blank image; ``variant`` makes distinct digests."""
    encoded, buffer = cv2.imencode(".jpg", np.zeros((height, width, 3), np.uint8))
    assert encoded
    return buffer.tobytes() + bytes([variant])


def write_blob(data_root: Path, data: bytes) -> str:
    digest = hashlib.sha256(data).hexdigest()
    target = blob_path(data_root, digest)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return digest
