import json
from pathlib import Path

import pytest
from conftest import annotation_document, manifest_entry, write_manifest

from vitroflow.annotations import (
    load_annotations,
    load_complete_annotations,
    parse_annotation,
)

CONTRACT_FIXTURE = Path(__file__).parent / "fixtures" / "contracts" / "annotation.json"


def test_complete_annotations_are_the_training_source(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    manifest = write_manifest(
        data_root,
        "batch",
        [
            manifest_entry("1" * 64, label=annotation_document("1" * 64, revision=3)),
            manifest_entry(
                "2" * 64, label=annotation_document("2" * 64, status="in_progress")
            ),
            manifest_entry("3" * 64),
        ],
    )

    complete = load_complete_annotations(manifest)

    assert [image.entry.digest for image in load_annotations(manifest)] == [
        "1" * 64,
        "2" * 64,
    ]
    assert len(complete) == 1
    annotation = complete[0].annotation
    assert complete[0].entry.extension == ".jpg"
    assert annotation.digest == "1" * 64
    assert annotation.boxes[0].center == (14.0, 23.0)
    assert annotation.revision == 3


def test_shared_annotation_contract() -> None:
    annotation = parse_annotation(
        json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    )

    assert annotation.digest == "c" * 64
    assert annotation.status == "complete"
    assert len(annotation.boxes) == 1


def test_label_must_describe_its_manifest_image(tmp_path: Path) -> None:
    manifest = write_manifest(
        tmp_path,
        "batch",
        [manifest_entry("1" * 64, label=annotation_document("2" * 64))],
    )
    with pytest.raises(ValueError, match="differs from its image"):
        load_annotations(manifest)


def test_manifest_rejects_unsupported_image_extensions(tmp_path: Path) -> None:
    manifest = write_manifest(
        tmp_path, "batch", [manifest_entry("1" * 64, extension=".webp")]
    )
    with pytest.raises(ValueError, match=r"images\[0\].extension must be one of"):
        load_annotations(manifest)


def test_unversioned_annotation_is_rejected() -> None:
    payload = annotation_document("1" * 64)
    del payload["schemaVersion"]

    with pytest.raises(ValueError, match="missing schemaVersion"):
        parse_annotation(payload)


def test_annotation_schema_rejects_unknown_fields_and_invalid_identities() -> None:
    payload = annotation_document("1" * 64)
    payload["unexpected"] = True
    with pytest.raises(ValueError, match="unknown unexpected"):
        parse_annotation(payload)

    with pytest.raises(ValueError, match="annotation.image.digest must be a SHA-256"):
        parse_annotation(annotation_document("images/a.jpg"))

    payload = annotation_document("1" * 64, status="excluded")
    payload["excludedReason"] = ""
    with pytest.raises(ValueError, match="excludedReason must be a non-empty string"):
        parse_annotation(payload)

    payload = annotation_document(
        "1" * 64, [{"x": 95, "y": 20, "width": 8, "height": 6}]
    )
    with pytest.raises(ValueError, match=r"instances\[0\].bbox exceeds image bounds"):
        parse_annotation(payload)
