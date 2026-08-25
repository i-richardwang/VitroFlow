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


def test_prepare_annotation_applies_review_corrections(tmp_path: Path) -> None:
    result_path = tmp_path / "sample.json"
    calibration_path = tmp_path / "review.json"
    result_path.write_text(
        json.dumps(
            {
                "source": "images/sample.jpg",
                "count": 5,
                "detections": [
                    {"id": 1, "x": 10, "y": 20},
                    {"id": 2, "x": 30, "y": 40},
                    {"id": 3, "x": 100, "y": 100},
                    {"id": 4, "x": 110, "y": 100},
                    {"id": 5, "x": 200, "y": 200},
                ],
            }
        ),
        encoding="utf-8",
    )
    calibration_path.write_text(
        json.dumps(
            {
                "image": "images/sample.jpg",
                "count": {"algorithm": 5, "calibrated": 5},
                "corrections": [
                    {"type": "remove", "id": 2},
                    {"type": "add", "point": {"x": 50, "y": 60}},
                    {"type": "merge", "ids": [3, 4], "point": {"x": 105, "y": 100}},
                    {
                        "type": "split",
                        "id": 5,
                        "points": [{"x": 200, "y": 200}, {"x": 215, "y": 200}],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    annotation = prepare_annotation(calibration_path, result_path)

    assert annotation == {
        "image": "images/sample.jpg",
        "positives": [
            {"x": 10.0, "y": 20.0},
            {"x": 50.0, "y": 60.0},
            {"x": 105.0, "y": 100.0},
            {"x": 200.0, "y": 200.0},
            {"x": 215.0, "y": 200.0},
        ],
        "negatives": [{"x": 30.0, "y": 40.0}],
    }
