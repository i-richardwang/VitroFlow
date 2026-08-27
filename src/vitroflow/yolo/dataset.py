from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import NotRequired, TypedDict

from ..annotations import BoundingBox, ReviewedImage
from ..files import atomic_directory
from ..image_io import read_image


class YoloManifestImage(TypedDict):
    source: str
    split: str
    image: str
    label: str
    instances: int
    revision: NotRequired[int]


class YoloDatasetManifest(TypedDict):
    class_names: list[str]
    seed: int
    validation_fraction: float
    images: list[YoloManifestImage]


@dataclass(frozen=True)
class DatasetImage:
    """Image and boxes in the canonical pixel-coordinate domain."""

    source: Path
    width: int
    height: int
    boxes: tuple[BoundingBox, ...]
    revision: int | None = None
    file_path: Path | None = None


def _export_name(image: DatasetImage) -> str:
    digest = hashlib.sha256(image.source.as_posix().encode()).hexdigest()[:12]
    return f"{digest}-{image.source.stem}"


def _label_text(image: DatasetImage) -> str:
    rows = []
    for box in image.boxes:
        center_x, center_y = box.center
        rows.append(
            "0 "
            f"{center_x / image.width:.8f} "
            f"{center_y / image.height:.8f} "
            f"{box.width / image.width:.8f} "
            f"{box.height / image.height:.8f}"
        )
    return "\n".join(rows) + ("\n" if rows else "")


def _source_image(data_root: Path, source: Path) -> Path:
    if source.is_absolute():
        raise ValueError(f"Image path must be relative: {source}")
    images_root = (data_root / "images").resolve()
    candidate = (data_root / source).resolve()
    try:
        candidate.relative_to(images_root)
    except ValueError:
        raise ValueError(f"Image is not under the images directory: {source}") from None
    return candidate


def _image_file(image: DatasetImage, data_root: Path) -> Path:
    if image.file_path is None:
        return _source_image(data_root, image.source)
    file_path = image.file_path.resolve()
    if not file_path.is_file():
        raise FileNotFoundError(file_path)
    return file_path


def _validation_sources(
    images: Sequence[DatasetImage], validation_fraction: float, seed: int
) -> set[Path]:
    ordered = sorted(
        images,
        key=lambda image: hashlib.sha256(
            f"{seed}:{image.source.as_posix()}".encode()
        ).hexdigest(),
    )
    count = min(len(ordered) - 1, max(1, round(len(ordered) * validation_fraction)))
    return {image.source for image in ordered[:count]}


def export_dataset_images(
    images: Sequence[DatasetImage],
    data_root: str | Path,
    output_dir: str | Path,
    *,
    validation_fraction: float = 0.2,
    seed: int = 0,
    splits: Mapping[Path, str] | None = None,
) -> YoloDatasetManifest:
    """Publish a self-contained one-class YOLO dataset atomically."""
    if len(images) < 2:
        raise ValueError("YOLO export requires at least two images")
    sources = [image.source for image in images]
    if len(set(sources)) != len(sources):
        raise ValueError("YOLO export requires unique image sources")
    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("Validation fraction must be between zero and one")

    root = Path(data_root).resolve()
    if splits is None:
        validation = _validation_sources(images, validation_fraction, seed)
    else:
        if set(splits) != set(sources):
            raise ValueError("Explicit YOLO splits must cover every image exactly once")
        if any(split not in {"train", "val"} for split in splits.values()):
            raise ValueError("YOLO split must be train or val")
        if set(splits.values()) != {"train", "val"}:
            raise ValueError("YOLO dataset requires both train and val images")
        validation = {source for source, split in splits.items() if split == "val"}
        validation_fraction = len(validation) / len(images)
    manifest_images: list[YoloManifestImage] = []

    with atomic_directory(output_dir) as working:
        for image in sorted(images, key=lambda item: item.source.as_posix()):
            split = "val" if image.source in validation else "train"
            source = _image_file(image, root)
            pixels = read_image(source)
            height, width = pixels.shape[:2]
            if (width, height) != (image.width, image.height):
                raise ValueError(
                    f"Image dimensions differ from annotation for {image.source}: "
                    f"{width}x{height} != {image.width}x{image.height}"
                )

            name = _export_name(image)
            image_destination = (
                working / "images" / split / f"{name}{source.suffix.lower()}"
            )
            label_destination = working / "labels" / split / f"{name}.txt"
            image_destination.parent.mkdir(parents=True, exist_ok=True)
            label_destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, image_destination)
            label_destination.write_text(_label_text(image), encoding="utf-8")

            entry = YoloManifestImage(
                source=image.source.as_posix(),
                split=split,
                image=image_destination.relative_to(working).as_posix(),
                label=label_destination.relative_to(working).as_posix(),
                instances=len(image.boxes),
            )
            if image.revision is not None:
                entry["revision"] = image.revision
            manifest_images.append(entry)

        manifest = YoloDatasetManifest(
            class_names=["seed"],
            seed=seed,
            validation_fraction=validation_fraction,
            images=manifest_images,
        )
        (working / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        (working / "dataset.yaml").write_text(
            "train: images/train\nval: images/val\nnames:\n  0: seed\n",
            encoding="utf-8",
        )
    return manifest


def export_yolo_dataset(
    annotations: Sequence[ReviewedImage],
    data_root: str | Path,
    output_dir: str | Path,
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> YoloDatasetManifest:
    """Export canonical reviewed annotations as a YOLO detection dataset."""
    images = [
        DatasetImage(
            source=annotation.source,
            width=annotation.width,
            height=annotation.height,
            boxes=annotation.boxes,
            revision=annotation.revision,
        )
        for annotation in annotations
    ]
    return export_dataset_images(
        images,
        data_root,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
    )
