import json
from dataclasses import replace
from pathlib import Path

import numpy as np

from vitroflow.evaluation import load_annotations, prepare_annotation
from vitroflow.scoring import DEFAULT_MODEL


def test_model_fingerprint_is_content_addressed() -> None:
    same_parameters = replace(DEFAULT_MODEL, name="alternate")
    different_parameters = replace(DEFAULT_MODEL, bias=DEFAULT_MODEL.bias + 0.01)

    assert same_parameters.fingerprint == DEFAULT_MODEL.fingerprint
    assert different_parameters.fingerprint != DEFAULT_MODEL.fingerprint


def test_load_annotations_preserves_empty_point_sets(tmp_path: Path) -> None:
    path = tmp_path / "sample.json"
    path.write_text(
        json.dumps(
            {
                "image": "images/sample.jpg",
                "positives": [{"x": 10, "y": 20}],
                "negatives": [],
            }
        ),
        encoding="utf-8",
    )

    annotations = load_annotations(path)

    assert annotations.image_path == Path("images/sample.jpg")
    assert annotations.image_key == "sample"
    assert np.array_equal(annotations.positives, [[10.0, 20.0]])
    assert annotations.negatives.shape == (0, 2)


def test_prepare_annotation_applies_review_edits(tmp_path: Path) -> None:
    result_path = tmp_path / "sample.json"
    calibration_path = tmp_path / "review.json"
    result_path.write_text(
        json.dumps(
            {
                "source": "images/sample.jpg",
                "count": 2,
                "detections": [
                    {"id": 1, "x": 10, "y": 20},
                    {"id": 2, "x": 30, "y": 40},
                ],
            }
        ),
        encoding="utf-8",
    )
    calibration_path.write_text(
        json.dumps(
            {
                "image": "images/sample.jpg",
                "count": {"algorithm": 2, "calibrated": 2},
                "removed": [{"id": 2, "x": 30, "y": 40}],
                "added": [{"x": 50, "y": 60}],
            }
        ),
        encoding="utf-8",
    )

    annotation = prepare_annotation(calibration_path, result_path)

    assert annotation == {
        "image": "images/sample.jpg",
        "positives": [{"x": 10.0, "y": 20.0}, {"x": 50.0, "y": 60.0}],
        "negatives": [{"x": 30.0, "y": 40.0}],
    }
