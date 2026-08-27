"""Materialize one workbench dataset as a local data root.

Local commands read ``images/``, ``prelabels/``, and ``labels/`` under a data
root. ``pull_dataset`` downloads those three trees for one dataset from the
workbench export API, verifies every image against its recorded digest, and
then swaps the trees into place so the local copy mirrors the server exactly.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

import httpx

from .identifiers import DATASET_NAME, FINGERPRINT, IMAGE_STEM

DOWNLOAD_TIMEOUT = httpx.Timeout(120.0, read=None)
EXPORT_SCHEMA_VERSION = 1
TREES = ("images", "prelabels", "labels")


class DatasetPullError(RuntimeError):
    pass


def _document(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DatasetPullError(f"{context} must be an object")
    return value


def _relative_source(source: str, dataset: str, stem: str) -> Path:
    prefix = f"images/{dataset}/{stem}."
    if not source.startswith(prefix) or "/" in source[len(prefix) :]:
        raise DatasetPullError(f"Unexpected image source: {source}")
    return Path(source)


def _digest(value: Any, source: Path) -> str:
    if not isinstance(value, str) or not FINGERPRINT.fullmatch(value):
        raise DatasetPullError(f"Image missing digest: {source}")
    return value


def _download_image(
    client: httpx.Client, url: str, target: Path, digest: str, source: Path
) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    with (
        client.stream("GET", url, timeout=DOWNLOAD_TIMEOUT) as response,
        target.open("wb") as handle,
    ):
        response.raise_for_status()
        for chunk in response.iter_bytes():
            hasher.update(chunk)
            handle.write(chunk)
    if hasher.hexdigest() != digest:
        raise DatasetPullError(f"Image digest mismatch for {source}")


def _write_json(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def _fetch_export(client: httpx.Client, dataset: str) -> list[dict[str, Any]]:
    response = client.get(f"api/export/datasets/{dataset}")
    response.raise_for_status()
    bundle = _document(response.json(), "export")
    if bundle.get("schemaVersion") != EXPORT_SCHEMA_VERSION:
        raise DatasetPullError(
            f"Unsupported export schema version: {bundle.get('schemaVersion')!r}"
        )
    images = bundle.get("images")
    if not isinstance(images, list):
        raise DatasetPullError("export must contain an image list")
    return [_document(raw, "image") for raw in images]


def _populate(
    client: httpx.Client, dataset: str, images: list[dict[str, Any]], root: Path
) -> None:
    for tree in TREES:
        (root / tree / dataset).mkdir(parents=True)
    for entry in images:
        stem = str(entry.get("stem", ""))
        if not IMAGE_STEM.fullmatch(stem):
            raise DatasetPullError(f"Invalid image stem: {stem}")
        source = _relative_source(str(entry.get("source", "")), dataset, stem)
        digest = _digest(entry.get("digest"), source)
        _download_image(
            client,
            f"api/export/datasets/{dataset}/images/{stem}",
            root / source,
            digest,
            source,
        )
        for kind in ("prelabel", "label"):
            document = entry.get(kind)
            if document is None:
                continue
            _write_json(
                root / f"{kind}s" / dataset / f"{stem}.json", _document(document, kind)
            )


def _swap_in(staging: Path, root: Path, dataset: str) -> None:
    """Replace all three trees, restoring the old copy if any rename fails."""
    backups = staging / "previous"
    backups.mkdir()
    installed: list[str] = []
    retired: list[str] = []
    try:
        for tree in TREES:
            target = root / tree / dataset
            target.parent.mkdir(parents=True, exist_ok=True)
            backup = backups / tree
            if target.exists():
                os.rename(target, backup)
                retired.append(tree)
            os.rename(staging / tree / dataset, target)
            installed.append(tree)
    except BaseException:
        for tree in reversed(installed):
            target = root / tree / dataset
            failed = staging / f"{tree}.failed"
            if target.exists():
                os.rename(target, failed)
        for tree in reversed(retired):
            backup = backups / tree
            target = root / tree / dataset
            if backup.exists():
                os.rename(backup, target)
        raise


def pull_dataset(
    server_url: str,
    token: str,
    dataset: str,
    output: str | Path,
    *,
    transport: httpx.BaseTransport | None = None,
) -> int:
    """Download one dataset into ``output`` and return the number of images.

    The download lands in a staging directory beside the data trees; the
    existing ``images/``, ``prelabels/``, and ``labels/`` subtrees for the
    dataset are only replaced once every image and document has been verified.
    """
    if not DATASET_NAME.fullmatch(dataset):
        raise DatasetPullError(f"Invalid dataset name: {dataset}")
    root = Path(output)
    root.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".pull-{dataset}-", dir=root))
    try:
        with httpx.Client(
            base_url=server_url.rstrip("/") + "/",
            headers={"Authorization": f"Bearer {token}"},
            timeout=120.0,
            transport=transport,
        ) as client:
            images = _fetch_export(client, dataset)
            _populate(client, dataset, images, staging)
        _swap_in(staging, root, dataset)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return len(images)
