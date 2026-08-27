from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import NotRequired, TypedDict

from ..annotations import BoundingBox, LabelledImage
from ..files import atomic_directory
from ..image_io import read_image
from ..manifest import verified_blob


class YoloManifestImage(TypedDict):
    digest: str
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
    """Image and boxes in the canonical pixel-coordinate domain.

    ``split`` carries the stable assignment the server recorded for the image;
    images without one are assigned locally from the seed and validation fraction.
    """

    digest: str
    extension: str
    width: int
    height: int
    boxes: tuple[BoundingBox, ...]
    split: str | None = None
    revision: int | None = None
    file_path: Path | None = None


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


def _image_file(image: DatasetImage, data_root: Path) -> Path:
    """The verified data-root blob, or the already verified file the caller supplied."""
    if image.file_path is None:
        return verified_blob(data_root, image.digest)
    if not image.file_path.is_file():
        raise FileNotFoundError(image.file_path)
    return image.file_path.resolve()


def assign_splits(
    images: Sequence[DatasetImage], validation_fraction: float, seed: int
) -> dict[str, str]:
    """Split per digest: recorded splits as they are, the rest seeded by digest.

    Locally assigned images fill the validation quota the fraction implies for
    the whole set, and the result always contains both a train and a val image.
    """
    splits = {image.digest: image.split for image in images if image.split}
    unassigned = sorted(
        (image for image in images if image.split is None),
        key=lambda image: hashlib.sha256(f"{seed}:{image.digest}".encode()).hexdigest(),
    )
    if unassigned:
        recorded_val = sum(split == "val" for split in splits.values())
        recorded_train = len(splits) - recorded_val
        quota = round(len(images) * validation_fraction) - recorded_val
        quota = max(quota, 1 - recorded_val)
        quota = min(quota, len(unassigned) - (1 - min(recorded_train, 1)))
        for index, image in enumerate(unassigned):
            splits[image.digest] = "val" if index < quota else "train"
    if set(splits.values()) != {"train", "val"}:
        raise ValueError("YOLO dataset requires both train and val images")
    return splits


def export_dataset_images(
    images: Sequence[DatasetImage],
    data_root: str | Path,
    output_dir: str | Path,
    *,
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> YoloDatasetManifest:
    """Publish a self-contained one-class YOLO dataset atomically."""
    if len(images) < 2:
        raise ValueError("YOLO export requires at least two images")
    digests = [image.digest for image in images]
    if len(set(digests)) != len(digests):
        raise ValueError("YOLO export requires unique image digests")
    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("Validation fraction must be between zero and one")

    root = Path(data_root).resolve()
    splits = assign_splits(images, validation_fraction, seed)
    manifest_images: list[YoloManifestImage] = []

    with atomic_directory(output_dir) as working:
        for image in sorted(images, key=lambda item: item.digest):
            split = splits[image.digest]
            source = _image_file(image, root)
            pixels = read_image(source)
            height, width = pixels.shape[:2]
            if (width, height) != (image.width, image.height):
                raise ValueError(
                    f"Image dimensions differ from annotation for {image.digest}: "
                    f"{width}x{height} != {image.width}x{image.height}"
                )

            image_destination = (
                working / "images" / split / f"{image.digest}{image.extension}"
            )
            label_destination = working / "labels" / split / f"{image.digest}.txt"
            image_destination.parent.mkdir(parents=True, exist_ok=True)
            label_destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, image_destination)
            label_destination.write_text(_label_text(image), encoding="utf-8")

            entry = YoloManifestImage(
                digest=image.digest,
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
    labelled: Sequence[LabelledImage],
    data_root: str | Path,
    output_dir: str | Path,
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> YoloDatasetManifest:
    """Export reviewed annotations as a YOLO detection dataset."""
    images = [
        DatasetImage(
            digest=image.entry.digest,
            extension=image.entry.extension,
            width=image.annotation.width,
            height=image.annotation.height,
            boxes=image.annotation.boxes,
            split=image.entry.split,
            revision=image.annotation.revision,
        )
        for image in labelled
    ]
    return export_dataset_images(
        images,
        data_root,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
    )
