import json
from dataclasses import replace
from pathlib import Path

import numpy as np

from vitroflow.candidates import CandidateEvidence
from vitroflow.evaluation import label_review_candidates, load_review
from vitroflow.proposals import SeedProposal
from vitroflow.scoring import DEFAULT_MODEL, CandidateModel


def _evidence(response: float) -> CandidateEvidence:
    return CandidateEvidence(
        response=response,
        contrast=0.0,
        chroma=0.0,
        support=0.0,
        finite_support=0.0,
        continuation=0.0,
        texture=0.0,
        surface_distance=0.0,
        elongation=0.0,
        persistence=0.0,
        rim_clearance=0.0,
    )


def test_model_fingerprint_is_content_addressed() -> None:
    same_parameters = replace(DEFAULT_MODEL, name="alternate")
    different_parameters = replace(DEFAULT_MODEL, bias=DEFAULT_MODEL.bias + 0.01)

    assert same_parameters.fingerprint == DEFAULT_MODEL.fingerprint
    assert different_parameters.fingerprint != DEFAULT_MODEL.fingerprint


def test_model_serialization_preserves_scores() -> None:
    restored = CandidateModel.from_dict(DEFAULT_MODEL.to_dict())
    features = np.zeros((2, len(DEFAULT_MODEL.feature_names)), dtype=np.float64)

    assert restored.fingerprint == DEFAULT_MODEL.fingerprint
    assert np.array_equal(
        restored.score_features(features),
        DEFAULT_MODEL.score_features(features),
    )


def test_review_preserves_explicit_labels_and_instance_relations(tmp_path: Path) -> None:
    result_path = tmp_path / "result.json"
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

    review = load_review(calibration_path, result_path)

    assert np.array_equal(
        review.seeds,
        [[50, 60], [200, 200], [215, 200]],
    )
    assert np.array_equal(review.background, [[30, 40]])
    assert len(review.same_instances) == 1
    assert len(review.distinct_instances) == 1


def test_candidate_matching_is_one_to_one() -> None:
    review = type("Review", (), {})()
    review.seeds = np.asarray([[10.0, 10.0], [12.0, 10.0]])
    review.background = np.empty((0, 2))
    review.image_key = "sample"
    proposals = [SeedProposal(11, 10, 5, 1, 1)]

    labeled = label_review_candidates(proposals, [_evidence(1.0)], review)

    assert labeled.matched_seeds == 1
    assert labeled.seed_count == 2
    assert labeled.proposal_recall == 0.5
