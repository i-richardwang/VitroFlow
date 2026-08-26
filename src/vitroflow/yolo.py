from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Sequence
from pathlib import Path

from .annotations import ReviewedImage
from .files import atomic_directory
from .image_io import read_image


def _export_name(annotation: ReviewedImage) -> str:
    digest = hashlib.sha256(annotation.source.as_posix().encode("utf-8")).hexdigest()[
        :12
    ]
    return f"{digest}-{annotation.source.stem}"


def _label_text(annotation: ReviewedImage) -> str:
    rows = []
    for box in annotation.boxes:
        center_x, center_y = box.center
        rows.append(
            "0 "
            f"{center_x / annotation.width:.8f} "
            f"{center_y / annotation.height:.8f} "
            f"{box.width / annotation.width:.8f} "
            f"{box.height / annotation.height:.8f}"
        )
    return "\n".join(rows) + ("\n" if rows else "")


def export_yolo_dataset(
    annotations: Sequence[ReviewedImage],
    data_root: str | Path,
    output_dir: str | Path,
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> dict[str, object]:
    if len(annotations) < 2:
        raise ValueError("YOLO export requires at least two complete images")
    sources = [annotation.source for annotation in annotations]
    if len(set(sources)) != len(sources):
        raise ValueError("YOLO export requires unique image sources")
    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("Validation fraction must be between zero and one")
    ordered = sorted(
        annotations,
        key=lambda annotation: hashlib.sha256(
            f"{seed}:{annotation.source.as_posix()}".encode()
        ).hexdigest(),
    )
    validation_count = min(
        len(ordered) - 1,
        max(1, round(len(ordered) * validation_fraction)),
    )
    validation_sources = {item.source for item in ordered[:validation_count]}
    manifest_entries: list[dict[str, object]] = []

    with atomic_directory(output_dir) as working:
        for annotation in sorted(annotations, key=lambda item: item.source.as_posix()):
            split = "val" if annotation.source in validation_sources else "train"
            image_path = annotation.image_path(data_root)
            image = read_image(image_path)
            height, width = image.shape[:2]
            if (width, height) != (annotation.width, annotation.height):
                raise ValueError(
                    f"Image dimensions differ from annotation for {annotation.source}: "
                    f"{width}x{height} != {annotation.width}x{annotation.height}"
                )
            name = _export_name(annotation)
            image_destination = (
                working / "images" / split / f"{name}{image_path.suffix.lower()}"
            )
            label_destination = working / "labels" / split / f"{name}.txt"
            image_destination.parent.mkdir(parents=True, exist_ok=True)
            label_destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image_path, image_destination)
            label_destination.write_text(_label_text(annotation), encoding="utf-8")
            manifest_entries.append(
                {
                    "source": annotation.source.as_posix(),
                    "split": split,
                    "image": image_destination.relative_to(working).as_posix(),
                    "label": label_destination.relative_to(working).as_posix(),
                    "instances": len(annotation.boxes),
                    "revision": annotation.revision,
                }
            )

        manifest: dict[str, object] = {
            "class_names": ["seed"],
            "seed": seed,
            "validation_fraction": validation_fraction,
            "images": manifest_entries,
        }
        (working / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )
        (working / "dataset.yaml").write_text(
            "path: .\ntrain: images/train\nval: images/val\nnames:\n  0: seed\n",
            encoding="utf-8",
        )
    return manifest
