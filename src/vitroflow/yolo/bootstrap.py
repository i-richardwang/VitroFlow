from __future__ import annotations

from pathlib import Path

from ..annotations import ReviewedInstance
from ..detectors import DetectionResult, parse_inference_outcome
from ..manifest import load_dataset_manifest
from .dataset import DatasetImage, YoloDatasetManifest, export_dataset_images


def export_detection_yolo_dataset(
    manifest: str | Path,
    data_root: str | Path,
    output_dir: str | Path,
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> YoloDatasetManifest:
    """Adapt a dataset's detections into a temporary YOLO dataset."""
    dataset = load_dataset_manifest(manifest)
    images = []
    for index, image in enumerate(dataset.images):
        if image.detection is None:
            continue
        document = parse_inference_outcome(
            image.detection, f"{manifest}: images[{index}].detection"
        )
        if not isinstance(document, DetectionResult):
            continue
        if document.digest != image.digest:
            raise ValueError(f"Detection digest differs from its image: {image.digest}")
        images.append(
            DatasetImage(
                digest=image.digest,
                width=document.width,
                height=document.height,
                instances=tuple(
                    ReviewedInstance(
                        instance_id=instance.instance_id,
                        class_name=instance.class_name,
                        bbox=instance.bbox,
                    )
                    for instance in document.instances
                ),
                split=image.split,
            )
        )
    if len(images) < 2:
        raise ValueError("Detection YOLO export requires at least two results")
    return export_dataset_images(
        images,
        dataset.classes,
        data_root,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
    )
