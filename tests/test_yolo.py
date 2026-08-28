from pathlib import Path

import pytest
from conftest import (
    annotation_document,
    encoded_image,
    manifest_entry,
    prelabel_document,
    write_blob,
    write_manifest,
)

from vitroflow.annotations import (
    LabelledImage,
    load_complete_annotations,
    parse_annotation,
)
from vitroflow.image_io import CANONICAL_EXTENSION
from vitroflow.manifest import BlobError, ManifestImage, blob_path
from vitroflow.yolo import (
    DatasetImage,
    assign_splits,
    export_dataset_images,
    export_prelabel_yolo_dataset,
    export_yolo_dataset,
)


def _labelled(digest: str, split: str | None = None) -> LabelledImage:
    entry = ManifestImage(
        digest=digest,
        width=100,
        height=80,
        filename=f"{digest[:4]}.jpg",
        bytes=1,
        split=split,
        prelabel=None,
        label=None,
    )
    annotation = annotation_document(
        digest, [{"x": 10, "y": 20, "width": 20, "height": 10}], revision=2
    )
    return LabelledImage(entry, parse_annotation(annotation))


def _labelled_blobs(
    data_root: Path, count: int, splits: tuple[str | None, ...] = ()
) -> list[LabelledImage]:
    """Labelled images whose blobs are written to ``data_root`` in variant order."""
    return [
        _labelled(
            write_blob(data_root, encoded_image(variant=variant)),
            splits[variant] if variant < len(splits) else None,
        )
        for variant in range(count)
    ]


def test_yolo_export_is_deterministic_and_self_contained(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    labelled = _labelled_blobs(data_root, 2)

    output = tmp_path / "yolo"
    manifest = export_yolo_dataset(labelled, data_root, output, seed=7)

    entries = manifest["images"]
    assert [entry["digest"] for entry in entries] == sorted(
        image.entry.digest for image in labelled
    )
    assert {entry["split"] for entry in entries} == {"train", "val"}
    for entry in entries:
        assert (
            entry["image"]
            == f"images/{entry['split']}/{entry['digest']}{CANONICAL_EXTENSION}"
        )
        assert entry["label"] == f"labels/{entry['split']}/{entry['digest']}.txt"
        assert entry["revision"] == 2
        assert (output / entry["image"]).is_file()
    dataset_yaml = (output / "dataset.yaml").read_text()
    assert "path:" not in dataset_yaml
    assert "train: images/train" in dataset_yaml
    labels = list((output / "labels").rglob("*.txt"))
    assert len(labels) == 2
    assert labels[0].read_text().strip().split() == [
        "0",
        "0.20000000",
        "0.31250000",
        "0.20000000",
        "0.12500000",
    ]

    with pytest.raises(FileExistsError, match="already exists"):
        export_yolo_dataset(labelled, data_root, output, seed=7)


def test_yolo_validation_split_is_stable_per_digest(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    labelled = _labelled_blobs(data_root, 5)

    first = export_yolo_dataset(labelled, data_root, tmp_path / "one", seed=3)
    second = export_yolo_dataset(labelled[::-1], data_root, tmp_path / "two", seed=3)

    assert first["images"] == second["images"]
    assert sum(entry["split"] == "val" for entry in first["images"]) == 1


def test_yolo_export_honours_recorded_splits(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    labelled = _labelled_blobs(data_root, 2, ("val", "train"))

    manifest = export_yolo_dataset(labelled, data_root, tmp_path / "yolo", seed=3)

    assert {entry["digest"]: entry["split"] for entry in manifest["images"]} == {
        image.entry.digest: image.entry.split for image in labelled
    }


def test_split_assignment_fills_the_quota_around_recorded_splits() -> None:
    def image(digest: str, split: str | None = None) -> DatasetImage:
        return DatasetImage(digest=digest, width=100, height=80, boxes=(), split=split)

    recorded = [image("1" * 64, "val"), image("2" * 64, "train")]
    unassigned = [image(f"{index:064x}") for index in range(3, 11)]

    splits = assign_splits(recorded + unassigned, 0.2, seed=1)

    assert splits["1" * 64] == "val" and splits["2" * 64] == "train"
    assert sum(split == "val" for split in splits.values()) == 2
    assert assign_splits(recorded + unassigned, 0.2, seed=1) == splits

    only_val = [image("1" * 64, "val"), image("2" * 64)]
    assert assign_splits(only_val, 0.9, seed=1)["2" * 64] == "train"
    only_train = [image("1" * 64, "train"), image("2" * 64)]
    assert assign_splits(only_train, 0.1, seed=1)["2" * 64] == "val"
    with pytest.raises(ValueError, match="both train and val"):
        assign_splits([image("1" * 64, "train"), image("2" * 64, "train")], 0.2, 1)


def test_yolo_export_requires_unique_digests(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    digest = write_blob(data_root, encoded_image())
    image = DatasetImage(digest=digest, width=100, height=80, boxes=())

    with pytest.raises(ValueError, match="unique image digests"):
        export_dataset_images([image, image], data_root, tmp_path / "dup")


def test_yolo_export_discards_an_invalid_dataset(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    labelled = [
        _labelled(write_blob(data_root, encoded_image())),
        _labelled(write_blob(data_root, encoded_image(height=60))),
    ]
    output = tmp_path / "yolo"

    with pytest.raises(ValueError, match="dimensions differ"):
        export_yolo_dataset(labelled, data_root, output)

    assert not output.exists()
    assert not list(tmp_path.glob(".yolo-*"))


def test_yolo_export_refuses_a_corrupted_blob(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    labelled = _labelled_blobs(data_root, 2)
    blob_path(data_root, labelled[1].entry.digest).write_bytes(encoded_image(variant=9))
    output = tmp_path / "yolo"

    with pytest.raises(BlobError, match="digest verification"):
        export_yolo_dataset(labelled, data_root, output)

    assert not output.exists()


def test_yolo_export_refuses_a_missing_blob(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    labelled = _labelled_blobs(data_root, 2)
    blob_path(data_root, labelled[0].entry.digest).unlink()

    with pytest.raises(BlobError, match="missing"):
        export_yolo_dataset(labelled, data_root, tmp_path / "yolo")


def test_export_reads_recorded_splits_from_the_manifest(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    entries = []
    for variant, split in enumerate(("val", "train")):
        digest = write_blob(data_root, encoded_image(variant=variant))
        entries.append(
            manifest_entry(digest, split=split, label=annotation_document(digest, []))
        )
    manifest_path = write_manifest(data_root, "batch", entries)

    labelled = load_complete_annotations(manifest_path)
    manifest = export_yolo_dataset(labelled, data_root, tmp_path / "yolo")

    recorded = {entry["digest"]: entry["split"] for entry in entries}
    assert {entry["digest"]: entry["split"] for entry in manifest["images"]} == recorded


def test_prelabel_export_builds_standard_boxes_from_prelabels(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    entries = []
    for variant in range(2):
        digest = write_blob(data_root, encoded_image(1000, 800, variant))
        entries.append(manifest_entry(digest, prelabel=prelabel_document(digest)))
    entries.append(
        manifest_entry(
            "c" * 64,
            prelabel={
                "schema_version": 1,
                "image": {"digest": "c" * 64},
                "producer": prelabel_document("c" * 64)["producer"],
                "error": "dish not found",
            },
        )
    )
    entries.append(manifest_entry("d" * 64))
    manifest_path = write_manifest(data_root, "batch", entries)

    output = tmp_path / "yolo"
    manifest = export_prelabel_yolo_dataset(manifest_path, data_root, output, seed=3)

    assert len(manifest["images"]) == 2
    assert all("revision" not in entry for entry in manifest["images"])
    labels = list((output / "labels").rglob("*.txt"))
    assert len(labels) == 2
    assert labels[0].read_text().strip().split() == [
        "0",
        "0.10000000",
        "0.25000000",
        "0.00750000",
        "0.00937500",
    ]


def test_prelabel_export_rejects_an_unversioned_document(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    payload = prelabel_document("1" * 64)
    del payload["schema_version"]
    manifest_path = write_manifest(
        data_root,
        "batch",
        [
            manifest_entry("1" * 64, prelabel=payload),
            manifest_entry("2" * 64, prelabel=payload),
        ],
    )

    output = tmp_path / "yolo"
    with pytest.raises(ValueError, match="missing schema_version"):
        export_prelabel_yolo_dataset(manifest_path, data_root, output)

    assert not output.exists()
