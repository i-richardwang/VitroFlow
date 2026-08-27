from __future__ import annotations

from pathlib import Path

from ..manifest import load_dataset_manifest
from ..prelabelers import PrelabelResult, parse_prelabel_document
from .dataset import DatasetImage, YoloDatasetManifest, export_dataset_images


def export_prelabel_yolo_dataset(
    manifest: str | Path,
    data_root: str | Path,
    output_dir: str | Path,
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> YoloDatasetManifest:
    """Adapt a dataset's successful prelabels into a temporary YOLO dataset."""
    images = []
    for index, image in enumerate(load_dataset_manifest(manifest).images):
        if image.prelabel is None:
            continue
        document = parse_prelabel_document(
            image.prelabel, f"{manifest}: images[{index}].prelabel"
        )
        if not isinstance(document, PrelabelResult):
            continue
        if document.digest != image.digest:
            raise ValueError(f"Prelabel digest differs from its image: {image.digest}")
        images.append(
            DatasetImage(
                digest=image.digest,
                extension=image.extension,
                width=document.width,
                height=document.height,
                boxes=tuple(instance.bbox for instance in document.instances),
                split=image.split,
            )
        )
    if len(images) < 2:
        raise ValueError("Prelabel YOLO export requires at least two results")
    return export_dataset_images(
        images,
        data_root,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
    )
