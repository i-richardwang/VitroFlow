"""The dataset manifest: one workbench dataset described by content-addressed images.

A data root holds every image as a blob named by the SHA-256 digest of its bytes
and one manifest per dataset listing those digests together with the detection and
label documents recorded for them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .documents import (
    as_digest,
    as_integer,
    as_list,
    as_object,
    as_string,
    expect_fields,
    expect_schema_version,
)
from .identifiers import CLASS_NAME, DATASET_NAME, VERSION_ID
from .image_io import content_digest

MANIFEST_SCHEMA_VERSION = 1
SPLITS = frozenset({"train", "val"})


@dataclass(frozen=True)
class ManifestImage:
    digest: str
    width: int
    height: int
    filename: str
    bytes: int
    split: str | None
    detection: dict[str, Any] | None
    label: dict[str, Any] | None


@dataclass(frozen=True)
class DatasetManifest:
    dataset: str
    model_id: str
    classes: tuple[str, ...]
    images: tuple[ManifestImage, ...]


class BlobError(RuntimeError):
    """A blob the data root should hold is missing or does not match its digest."""


def blob_path(data_root: str | Path, digest: str) -> Path:
    """Where the data root stores the blob named ``digest``; readers use ``verified_blob``."""
    return Path(data_root) / "blobs" / digest[:2] / digest


def verified_blob(data_root: str | Path, digest: str) -> Path:
    """The path of the blob named ``digest`` once its bytes hash to that digest."""
    path = blob_path(data_root, digest)
    try:
        data = path.read_bytes()
    except FileNotFoundError as error:
        raise BlobError(f"Blob is missing from the data root: {digest}") from error
    if content_digest(data) != digest:
        raise BlobError(f"Blob failed digest verification: {digest}")
    return path


def manifest_path(data_root: str | Path, dataset: str) -> Path:
    return Path(data_root) / "datasets" / f"{dataset}.json"


def as_split(value: Any, context: str) -> str:
    if value not in SPLITS:
        raise ValueError(f"{context} must be train or val")
    return value


def _optional_object(value: Any, context: str) -> dict[str, Any] | None:
    return None if value is None else as_object(value, context)


def _image(value: Any, context: str) -> ManifestImage:
    entry = as_object(value, context)
    expect_fields(
        entry,
        {
            "digest",
            "width",
            "height",
            "filename",
            "bytes",
            "split",
            "detection",
            "label",
        },
        context,
    )
    return ManifestImage(
        digest=as_digest(entry["digest"], f"{context}.digest"),
        width=as_integer(entry["width"], f"{context}.width", minimum=1),
        height=as_integer(entry["height"], f"{context}.height", minimum=1),
        filename=as_string(entry["filename"], f"{context}.filename"),
        bytes=as_integer(entry["bytes"], f"{context}.bytes"),
        split=(
            None
            if entry["split"] is None
            else as_split(entry["split"], f"{context}.split")
        ),
        detection=_optional_object(entry["detection"], f"{context}.detection"),
        label=_optional_object(entry["label"], f"{context}.label"),
    )


def parse_dataset_manifest(value: Any, context: str = "manifest") -> DatasetManifest:
    document = as_object(value, context)
    expect_fields(document, {"schemaVersion", "dataset", "model", "images"}, context)
    expect_schema_version(document, "schemaVersion", MANIFEST_SCHEMA_VERSION, context)
    dataset = as_string(document["dataset"], f"{context}.dataset")
    if not DATASET_NAME.fullmatch(dataset):
        raise ValueError(f"{context}.dataset is invalid")
    model = as_object(document["model"], f"{context}.model")
    expect_fields(model, {"id", "classes"}, f"{context}.model")
    model_id = as_string(model["id"], f"{context}.model.id")
    if not VERSION_ID.fullmatch(model_id):
        raise ValueError(f"{context}.model.id is invalid")
    classes = tuple(
        as_string(item, f"{context}.model.classes[{index}]")
        for index, item in enumerate(
            as_list(model["classes"], f"{context}.model.classes")
        )
    )
    if not classes or len(set(classes)) != len(classes):
        raise ValueError(f"{context}.model.classes must be non-empty and unique")
    for name in classes:
        if not CLASS_NAME.fullmatch(name):
            raise ValueError(f"{context}.model.classes contains invalid class {name}")
    images = tuple(
        _image(raw, f"{context}.images[{index}]")
        for index, raw in enumerate(as_list(document["images"], f"{context}.images"))
    )
    digests = [image.digest for image in images]
    if len(set(digests)) != len(digests):
        raise ValueError(f"{context} lists an image digest more than once")
    return DatasetManifest(
        dataset=dataset, model_id=model_id, classes=classes, images=images
    )


def load_dataset_manifest(path: str | Path) -> DatasetManifest:
    source = Path(path)
    return parse_dataset_manifest(
        json.loads(source.read_text(encoding="utf-8")), str(source)
    )
