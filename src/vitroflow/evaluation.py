from __future__ import annotations

import json
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path

import numpy as np

from .candidates import FEATURE_NAMES, CandidateEvidence
from .proposals import SeedProposal
from .scoring import CandidateModel


@dataclass(frozen=True)
class PointRelation:
    first: tuple[float, float]
    second: tuple[float, float]


@dataclass(frozen=True)
class ImageReview:
    image_path: Path
    image_key: str
    seeds: np.ndarray
    background: np.ndarray
    same_instances: tuple[PointRelation, ...]
    distinct_instances: tuple[PointRelation, ...]


@dataclass(frozen=True)
class LabeledCandidates:
    features: np.ndarray
    labels: np.ndarray
    groups: np.ndarray
    proposal_recall: float
    matched_seeds: int
    seed_count: int


def _point(value: dict[str, object]) -> tuple[float, float]:
    return float(value["x"]), float(value["y"])


def _relations(points: list[tuple[float, float]]) -> list[PointRelation]:
    return [PointRelation(first, second) for first, second in combinations(points, 2)]


def load_review(
    calibration_path: str | Path,
    result_path: str | Path,
) -> ImageReview:
    calibration_path = Path(calibration_path)
    result_path = Path(result_path)
    calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
    result = json.loads(result_path.read_text(encoding="utf-8"))
    if calibration["image"] != result["source"]:
        raise ValueError(f"Image mismatch between {calibration_path} and {result_path}")
    if int(calibration["count"]["algorithm"]) != int(result["count"]):
        raise ValueError(f"Count mismatch between {calibration_path} and {result_path}")

    detections = {int(item["id"]): item for item in result["detections"]}
    consumed: set[int] = set()
    seeds: list[tuple[float, float]] = []
    background: list[tuple[float, float]] = []
    same_instances: list[PointRelation] = []
    distinct_instances: list[PointRelation] = []

    for correction in calibration["corrections"]:
        kind = correction["type"]
        if kind in {"remove", "split"}:
            ids = [int(correction["id"])]
        elif kind == "merge":
            ids = [int(value) for value in correction["ids"]]
        elif kind == "add":
            ids = []
        else:
            raise ValueError(f"Unknown correction type: {kind}")
        for detection_id in ids:
            if detection_id not in detections:
                raise ValueError(
                    f"Unknown detection id {detection_id} in {calibration_path}"
                )
            if detection_id in consumed:
                raise ValueError(
                    f"Detection {detection_id} corrected twice in {calibration_path}"
                )
            consumed.add(detection_id)

        if kind == "add":
            seeds.append(_point(correction["point"]))
        elif kind == "remove":
            background.append(_point(detections[ids[0]]))
        elif kind == "merge":
            points = [_point(detections[detection_id]) for detection_id in ids]
            same_instances.extend(_relations(points))
        elif kind == "split":
            points = [_point(value) for value in correction["points"]]
            seeds.extend(points)
            distinct_instances.extend(_relations(points))

    return ImageReview(
        image_path=Path(calibration["image"]),
        image_key=Path(calibration["image"]).stem,
        seeds=np.asarray(seeds, dtype=np.float64).reshape(-1, 2),
        background=np.asarray(background, dtype=np.float64).reshape(-1, 2),
        same_instances=tuple(same_instances),
        distinct_instances=tuple(distinct_instances),
    )


def _match_points(
    points: np.ndarray,
    coordinates: np.ndarray,
    radius: float,
    unavailable: set[int] | None = None,
) -> dict[int, int]:
    if not len(points) or not len(coordinates):
        return {}
    unavailable = unavailable or set()
    squared_distance = np.sum(
        np.square(points[:, None, :] - coordinates[None, :, :]),
        axis=2,
    )
    point_indices, candidate_indices = np.where(squared_distance <= radius**2)
    edges = sorted(
        zip(
            squared_distance[point_indices, candidate_indices],
            point_indices,
            candidate_indices,
            strict=True,
        )
    )
    matched_points: set[int] = set()
    matched_candidates = set(unavailable)
    assignments: dict[int, int] = {}
    for _, point_index, candidate_index in edges:
        point_index = int(point_index)
        candidate_index = int(candidate_index)
        if point_index in matched_points or candidate_index in matched_candidates:
            continue
        assignments[point_index] = candidate_index
        matched_points.add(point_index)
        matched_candidates.add(candidate_index)
    return assignments


def label_review_candidates(
    proposals: list[SeedProposal],
    evidence: list[CandidateEvidence],
    review: ImageReview,
    match_radius: float = 32.0,
) -> LabeledCandidates:
    coordinates = np.asarray(
        [(proposal.x, proposal.y) for proposal in proposals], dtype=np.float64
    ).reshape(-1, 2)
    feature_matrix = (
        np.vstack([item.to_array() for item in evidence])
        if evidence
        else np.empty((0, len(FEATURE_NAMES)), dtype=np.float64)
    )
    positive = _match_points(review.seeds, coordinates, match_radius)
    positive_candidates = set(positive.values())
    negative = _match_points(
        review.background,
        coordinates,
        match_radius,
        positive_candidates,
    )
    selected = list(positive.values()) + list(negative.values())
    return LabeledCandidates(
        features=feature_matrix[selected],
        labels=np.asarray(
            [1] * len(positive) + [0] * len(negative), dtype=np.int64
        ),
        groups=np.full(len(selected), review.image_key, dtype=object),
        proposal_recall=len(positive) / max(len(review.seeds), 1),
        matched_seeds=len(positive),
        seed_count=len(review.seeds),
    )


def combine_labeled(datasets: list[LabeledCandidates]) -> LabeledCandidates:
    if not datasets:
        raise ValueError("At least one reviewed image is required")
    matched = sum(dataset.matched_seeds for dataset in datasets)
    seeds = sum(dataset.seed_count for dataset in datasets)
    return LabeledCandidates(
        features=np.vstack([dataset.features for dataset in datasets]),
        labels=np.concatenate([dataset.labels for dataset in datasets]),
        groups=np.concatenate([dataset.groups for dataset in datasets]),
        proposal_recall=matched / max(seeds, 1),
        matched_seeds=matched,
        seed_count=seeds,
    )


def fit_review_model(
    features: np.ndarray,
    labels: np.ndarray,
    base_model: CandidateModel,
    confidence_threshold: float,
    bandwidth: float,
    regularization: float,
    margin: float = 1.5,
    model_name: str = "candidate-seedness",
) -> CandidateModel:
    if set(np.unique(labels)) != {0, 1}:
        raise ValueError("Model fitting requires seed and background candidates")
    if not 0.0 < confidence_threshold < 1.0:
        raise ValueError("Model fitting threshold must be between zero and one")
    centers = np.clip(
        (features - np.asarray(base_model.means)) / np.asarray(base_model.scales),
        -6.0,
        6.0,
    )
    squared_distance = np.maximum(
        np.sum(np.square(centers), axis=1)[:, None]
        + np.sum(np.square(centers), axis=1)[None, :]
        - 2.0 * centers @ centers.T,
        0.0,
    )
    kernel = np.exp(-squared_distance / (2.0 * bandwidth**2))
    base_logits = centers @ np.asarray(base_model.weights) + base_model.bias
    boundary = float(
        np.log(confidence_threshold / max(1.0 - confidence_threshold, 1e-12))
    )
    targets = np.where(labels == 1, boundary + margin, boundary - margin) - base_logits
    positive_mass = max(int(np.sum(labels == 1)), 1)
    negative_mass = max(int(np.sum(labels == 0)), 1)
    sample_weights = np.where(
        labels == 1,
        0.5 / positive_mass,
        0.5 / negative_mass,
    ) * len(labels)
    coefficients = np.linalg.solve(
        kernel * sample_weights[:, None]
        + regularization * np.eye(len(kernel)),
        targets * sample_weights,
    )
    return CandidateModel(
        name=model_name,
        feature_names=base_model.feature_names,
        means=base_model.means,
        scales=base_model.scales,
        weights=base_model.weights,
        bias=base_model.bias,
        calibration_centers=tuple(
            tuple(float(value) for value in center) for center in centers
        ),
        calibration_weights=tuple(float(value) for value in coefficients),
        calibration_bandwidth=bandwidth,
    )
