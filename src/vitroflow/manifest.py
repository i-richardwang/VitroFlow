"""The dataset manifest: one workbench dataset described by content-addressed images.

A data root holds every image as a blob named by the SHA-256 digest of its bytes
and one manifest per dataset listing those digests together with the detection and
annotation documents recorded for them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .annotations import AnnotationDocument, parse_annotation
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
from .image_io import MAX_IMAGE_BYTES, content_digest

if TYPE_CHECKING:
    from .detectors.contract import DetectionResult

MANIFEST_SCHEMA_VERSION = 1
MAX_DATASET_IMAGES = 10_000
MAX_DATASET_MANIFEST_BYTES = 16 * 1024 * 1024
SPLITS = frozenset({"train", "val"})


@dataclass(frozen=True)
class ManifestImage:
    digest: str
    width: int
    height: int
    filename: str
    bytes: int
    split: str | None
    detection: DetectionResult | None
    annotation: AnnotationDocument | None

    def to_dict(self) -> dict[str, object]:
        return {
            "digest": self.digest,
            "width": self.width,
            "height": self.height,
            "filename": self.filename,
            "bytes": self.bytes,
            "split": self.split,
            "detection": None if self.detection is None else self.detection.to_dict(),
            "annotation": (
                None if self.annotation is None else self.annotation.to_dict()
            ),
        }


@dataclass(frozen=True)
class DatasetManifest:
    dataset: str
    model_id: str
    classes: tuple[str, ...]
    images: tuple[ManifestImage, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": MANIFEST_SCHEMA_VERSION,
            "dataset": self.dataset,
            "model": {"id": self.model_id, "classes": list(self.classes)},
            "images": [image.to_dict() for image in self.images],
        }


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


def _image(value: Any, context: str) -> ManifestImage:
    from .detectors.contract import DetectionResult
    from .detectors.documents import parse_inference_outcome

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
            "annotation",
        },
        context,
    )
    detection = None
    if entry["detection"] is not None:
        outcome = parse_inference_outcome(entry["detection"], f"{context}.detection")
        if not isinstance(outcome, DetectionResult):
            raise ValueError(f"{context}.detection must be a detection result")
        detection = outcome
    annotation = (
        None
        if entry["annotation"] is None
        else parse_annotation(entry["annotation"], f"{context}.annotation")
    )
    image_bytes = as_integer(entry["bytes"], f"{context}.bytes", minimum=1)
    if image_bytes > MAX_IMAGE_BYTES:
        raise ValueError(f"{context}.bytes must be at most {MAX_IMAGE_BYTES}")
    return ManifestImage(
        digest=as_digest(entry["digest"], f"{context}.digest"),
        width=as_integer(entry["width"], f"{context}.width", minimum=1),
        height=as_integer(entry["height"], f"{context}.height", minimum=1),
        filename=as_string(entry["filename"], f"{context}.filename"),
        bytes=image_bytes,
        split=(
            None
            if entry["split"] is None
            else as_split(entry["split"], f"{context}.split")
        ),
        detection=detection,
        annotation=annotation,
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
    if len(images) > MAX_DATASET_IMAGES:
        raise ValueError(
            f"{context}.images must contain at most {MAX_DATASET_IMAGES} images"
        )
    digests = [image.digest for image in images]
    if len(set(digests)) != len(digests):
        raise ValueError(f"{context} lists an image digest more than once")
    known_classes = set(classes)
    for index, image in enumerate(images):
        for field, payload in (
            ("detection", image.detection),
            ("annotation", image.annotation),
        ):
            if payload is None:
                continue
            document_context = f"{context}.images[{index}].{field}"
            if payload.digest != image.digest:
                raise ValueError(f"{document_context} describes another image")
            if payload.width != image.width or payload.height != image.height:
                raise ValueError(f"{document_context} dimensions differ from the image")
            unknown = sorted(
                {instance.class_name for instance in payload.instances} - known_classes
            )
            if unknown:
                raise ValueError(
                    f"{document_context} uses unknown class"
                    f"{'es' if len(unknown) > 1 else ''}: {', '.join(unknown)}"
                )
    return DatasetManifest(
        dataset=dataset, model_id=model_id, classes=classes, images=images
    )


def encode_dataset_manifest(manifest: DatasetManifest) -> bytes:
    """Encode the canonical manifest representation used in transit."""
    encoded = (
        json.dumps(manifest.to_dict(), ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    if len(encoded) > MAX_DATASET_MANIFEST_BYTES:
        raise ValueError("Manifest exceeds 16 MiB")
    return encoded


def load_dataset_manifest(path: str | Path) -> DatasetManifest:
    source = Path(path)
    return parse_dataset_manifest(
        json.loads(source.read_text(encoding="utf-8")), str(source)
    )
