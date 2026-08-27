"""Materialize one workbench dataset as a local data root.

A data root stores image bytes as content-addressed blobs shared by every
dataset and one manifest per dataset. ``pull_dataset`` fetches the dataset's
export document, keeps every local blob that verifies against its digest,
downloads the rest, and then installs the manifest with a single atomic rename.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import httpx

from .files import atomic_file, write_text_atomically
from .identifiers import DATASET_NAME
from .image_io import verify_digest
from .manifest import (
    BlobError,
    DatasetManifest,
    blob_path,
    manifest_path,
    parse_dataset_manifest,
    verified_blob,
)

DOWNLOAD_TIMEOUT = httpx.Timeout(120.0, read=None)


class DatasetPullError(RuntimeError):
    pass


@dataclass(frozen=True)
class PullReport:
    """How each image of the pulled dataset reached the data root."""

    dataset: str
    kept: int
    downloaded: int
    replaced: int

    @property
    def images(self) -> int:
        return self.kept + self.downloaded + self.replaced


def _download_blob(client: httpx.Client, digest: str, target: Path) -> None:
    response = client.get(f"api/export/images/{digest}", timeout=DOWNLOAD_TIMEOUT)
    response.raise_for_status()
    try:
        contents = verify_digest(response.content, digest)
    except ValueError as error:
        raise DatasetPullError(str(error)) from error
    with atomic_file(target) as handle:
        handle.write(contents)


def _fetch_export(
    client: httpx.Client, dataset: str
) -> tuple[DatasetManifest, dict[str, object]]:
    response = client.get(f"api/export/datasets/{dataset}")
    response.raise_for_status()
    document = response.json()
    try:
        manifest = parse_dataset_manifest(document, "export")
    except (TypeError, ValueError) as error:
        raise DatasetPullError(str(error)) from error
    if manifest.dataset != dataset:
        raise DatasetPullError(f"Export describes another dataset: {manifest.dataset}")
    return manifest, document


def pull_dataset(
    server_url: str,
    token: str,
    dataset: str,
    output: str | Path,
    *,
    transport: httpx.BaseTransport | None = None,
) -> PullReport:
    """Mirror one dataset into ``output`` and report what the pull did.

    A local blob is kept only when its bytes verify against its digest; a
    missing or failing blob is downloaded and verified, replacing any file that
    was there. The manifest is installed once every blob is in place.
    """
    if not DATASET_NAME.fullmatch(dataset):
        raise DatasetPullError(f"Invalid dataset name: {dataset}")
    root = Path(output)
    root.mkdir(parents=True, exist_ok=True)
    kept = downloaded = replaced = 0
    with httpx.Client(
        base_url=server_url.rstrip("/") + "/",
        headers={"Authorization": f"Bearer {token}"},
        timeout=120.0,
        transport=transport,
    ) as client:
        manifest, document = _fetch_export(client, dataset)
        for image in manifest.images:
            target = blob_path(root, image.digest)
            try:
                verified_blob(root, image.digest)
            except BlobError:
                present = target.is_file()
                _download_blob(client, image.digest, target)
                if present:
                    replaced += 1
                else:
                    downloaded += 1
            else:
                kept += 1
    write_text_atomically(
        manifest_path(root, dataset), json.dumps(document, indent=2) + "\n"
    )
    return PullReport(dataset, kept, downloaded, replaced)
