from __future__ import annotations

from pathlib import Path

from ..prelabelers import PrelabelResult, load_prelabel_document
from .dataset import DatasetImage, YoloDatasetManifest, export_dataset_images


def _dataset_image(result: PrelabelResult) -> DatasetImage:
    return DatasetImage(
        source=result.source,
        width=result.width,
        height=result.height,
        boxes=tuple(instance.bbox for instance in result.instances),
    )


def export_prelabel_yolo_dataset(
    prelabels_dir: str | Path,
    data_root: str | Path,
    output_dir: str | Path,
    validation_fraction: float = 0.2,
    seed: int = 0,
) -> YoloDatasetManifest:
    """Adapt successful canonical prelabels into a temporary YOLO dataset."""
    directory = Path(prelabels_dir)
    if not directory.is_dir():
        raise FileNotFoundError(directory)
    results = []
    for path in sorted(directory.glob("*.json")):
        document = load_prelabel_document(path)
        if isinstance(document, PrelabelResult):
            results.append(document)
    if len(results) < 2:
        raise ValueError("Prelabel YOLO export requires at least two results")
    return export_dataset_images(
        [_dataset_image(result) for result in results],
        data_root,
        output_dir,
        validation_fraction=validation_fraction,
        seed=seed,
    )
