import json
from pathlib import Path

import pytest

from vitroflow.annotations import load_annotation, load_complete_annotations

CONTRACT_FIXTURE = Path(__file__).parent / "fixtures" / "contracts" / "annotation.json"


def _payload(source: str, status: str = "complete") -> dict[str, object]:
    return {
        "schemaVersion": 2,
        "image": {"path": source, "width": 100, "height": 80},
        "source": {
            "modelVersionId": "batch.traditional-v1",
            "artifactDigest": "a" * 64,
            "runtime": {
                "adapter": "traditional",
                "fingerprint": "b" * 64,
            },
        },
        "status": status,
        "revision": 3,
        "instances": [
            {
                "id": "seed-1",
                "class": "seed",
                "bbox": {"x": 10, "y": 20, "width": 8, "height": 6},
            }
        ],
    }


def _write(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_complete_annotations_are_the_training_source(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    labels = data_root / "labels"
    _write(labels / "batch" / "complete.json", _payload("images/batch/a.jpg"))
    _write(
        labels / "batch" / "progress.json",
        _payload("images/batch/b.jpg", "in_progress"),
    )

    annotations = load_complete_annotations(labels, data_root)

    assert len(annotations) == 1
    assert annotations[0].source == Path("images/batch/a.jpg")
    assert annotations[0].boxes[0].center == (14.0, 23.0)
    assert annotations[0].revision == 3


def test_shared_annotation_contract() -> None:
    annotation = load_annotation(CONTRACT_FIXTURE, CONTRACT_FIXTURE.parent)

    assert annotation.source == Path("images/set/example.jpg")
    assert annotation.status == "complete"
    assert len(annotation.boxes) == 1


def test_unversioned_annotation_is_rejected(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    label = data_root / "labels" / "unversioned.json"
    payload = _payload("images/unversioned.jpg")
    del payload["schemaVersion"]
    _write(label, payload)

    with pytest.raises(ValueError, match="missing schemaVersion"):
        load_annotation(label, data_root)


def test_annotation_schema_rejects_unknown_fields_and_escaping_paths(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    label = data_root / "labels" / "bad.json"
    payload = _payload("images/a.jpg")
    payload["unexpected"] = True
    _write(label, payload)
    with pytest.raises(ValueError, match="unknown unexpected"):
        load_annotation(label, data_root)

    _write(label, _payload("../outside.jpg"))
    with pytest.raises(ValueError, match="escapes the data root"):
        load_annotation(label, data_root)

    payload = _payload("images/a.jpg", "excluded")
    payload["excludedReason"] = ""
    _write(label, payload)
    with pytest.raises(ValueError, match="non-empty string"):
        load_annotation(label, data_root)
