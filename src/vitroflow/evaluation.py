from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .candidates import FEATURE_NAMES, CandidateEvidence
from .proposals import SeedProposal
from .scoring import CandidateModel


@dataclass(frozen=True)
class ImageAnnotations:
    image_path: Path
    image_key: str
    positives: np.ndarray
    negatives: np.ndarray


@dataclass(frozen=True)
class LabeledCandidates:
    features: np.ndarray
    labels: np.ndarray
    weights: np.ndarray
    groups: np.ndarray
    proposal_recall: float
    matched_positives: int
    positive_count: int


def load_annotations(path: str | Path) -> ImageAnnotations:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    image_path = Path(data["image"])
    positives = [(float(item["x"]), float(item["y"])) for item in data["positives"]]
    negatives = [(float(item["x"]), float(item["y"])) for item in data["negatives"]]
    return ImageAnnotations(
        image_path=image_path,
        image_key=image_path.stem,
        positives=np.asarray(positives, dtype=np.float64).reshape(-1, 2),
        negatives=np.asarray(negatives, dtype=np.float64).reshape(-1, 2),
    )


def _consumed_ids(correction: dict[str, object]) -> list[int]:
    """Detection ids a review correction consumes."""
    kind = correction["type"]
    if kind == "remove" or kind == "split":
        return [int(correction["id"])]
    if kind == "merge":
        return [int(value) for value in correction["ids"]]
    if kind == "add":
        return []
    raise ValueError(f"Unknown correction type: {kind}")


def _asserted_seeds(correction: dict[str, object]) -> list[dict[str, float]]:
    """Seed positions a review correction asserts in place of what it consumes."""
    kind = correction["type"]
    if kind == "add" or kind == "merge":
        points = [correction["point"]]
    elif kind == "split":
        points = correction["points"]
    else:
        points = []
    return [{"x": float(point["x"]), "y": float(point["y"])} for point in points]


def prepare_annotation(
    calibration_path: str | Path, result_path: str | Path
) -> dict[str, object]:
    """Turns review corrections into positive and negative point labels."""
    calibration_path = Path(calibration_path)
    result_path = Path(result_path)
    calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
    result = json.loads(result_path.read_text(encoding="utf-8"))
    if calibration["image"] != result["source"]:
        raise ValueError(f"Image mismatch between {calibration_path} and {result_path}")
    if int(calibration["count"]["algorithm"]) != int(result["count"]):
        raise ValueError(f"Count mismatch between {calibration_path} and {result_path}")

    detections = {int(item["id"]): item for item in result["detections"]}
    corrections = calibration["corrections"]
    consumed: dict[int, str] = {}
    for correction in corrections:
        for detection_id in _consumed_ids(correction):
            if detection_id not in detections:
                raise ValueError(
                    f"Unknown detection id {detection_id} in {calibration_path}"
                )
            if detection_id in consumed:
                raise ValueError(
                    f"Detection {detection_id} corrected twice in {calibration_path}"
                )
            consumed[detection_id] = str(correction["type"])

    positives = [
        {"x": float(item["x"]), "y": float(item["y"])}
        for detection_id, item in detections.items()
        if detection_id not in consumed
    ]
    for correction in corrections:
        positives.extend(_asserted_seeds(correction))
    negatives = [
        {"x": float(detections[detection_id]["x"]), "y": float(detections[detection_id]["y"])}
        for detection_id, kind in consumed.items()
        if kind == "remove"
    ]
    return {"image": calibration["image"], "positives": positives, "negatives": negatives}


def label_candidates(
    proposals: list[SeedProposal],
    evidence: list[CandidateEvidence],
    annotations: ImageAnnotations,
    match_radius: float = 32.0,
    background_radius: float = 50.0,
    background_weight: float = 0.03,
) -> LabeledCandidates:
    coordinates = np.asarray(
        [(proposal.x, proposal.y) for proposal in proposals], dtype=np.float64
    ).reshape(-1, 2)
    feature_matrix = np.vstack([item.to_array() for item in evidence])
    selected: dict[int, tuple[int, float]] = {}

    def match(points: np.ndarray, label: int, reliability: float) -> int:
        matched = 0
        for point in points:
            if not len(coordinates):
                continue
            distances = np.sum((coordinates - point) ** 2, axis=1)
            index = int(np.argmin(distances))
            if distances[index] <= match_radius**2:
                matched += 1
                if label == 1 or index not in selected:
                    selected[index] = (label, reliability)
        return matched

    matched_positives = match(annotations.positives, 1, 1.0)
    match(annotations.negatives, 0, 3.0)
    if len(coordinates) and len(annotations.positives):
        minimum_distance = np.full(len(coordinates), np.inf, dtype=np.float64)
        for point in annotations.positives:
            minimum_distance = np.minimum(
                minimum_distance,
                np.sum((coordinates - point) ** 2, axis=1),
            )
        background = np.flatnonzero(minimum_distance > background_radius**2)
        background = np.asarray(
            [index for index in background if int(index) not in selected],
            dtype=np.int64,
        )
        for index in background:
            selected[int(index)] = (0, background_weight)
    indices = np.fromiter(selected, dtype=np.int64)
    labels = np.asarray([selected[int(index)][0] for index in indices], dtype=np.int64)
    weights = np.asarray(
        [selected[int(index)][1] for index in indices], dtype=np.float64
    )
    return LabeledCandidates(
        features=feature_matrix[indices],
        labels=labels,
        weights=weights,
        groups=np.full(len(indices), annotations.image_key, dtype=object),
        proposal_recall=matched_positives / max(len(annotations.positives), 1),
        matched_positives=matched_positives,
        positive_count=len(annotations.positives),
    )


def combine_labeled(datasets: list[LabeledCandidates]) -> LabeledCandidates:
    if not datasets:
        raise ValueError("At least one annotated image is required")
    return LabeledCandidates(
        features=np.vstack([dataset.features for dataset in datasets]),
        labels=np.concatenate([dataset.labels for dataset in datasets]),
        weights=np.concatenate([dataset.weights for dataset in datasets]),
        groups=np.concatenate([dataset.groups for dataset in datasets]),
        proposal_recall=sum(item.matched_positives for item in datasets)
        / max(sum(item.positive_count for item in datasets), 1),
        matched_positives=sum(item.matched_positives for item in datasets),
        positive_count=sum(item.positive_count for item in datasets),
    )


def fit_logistic_model(
    features: np.ndarray,
    labels: np.ndarray,
    model_name: str,
    reliability: np.ndarray | None = None,
    regularization: float = 0.02,
    iterations: int = 50,
) -> CandidateModel:
    if set(np.unique(labels)) != {0, 1}:
        raise ValueError("Model fitting requires positive and negative candidates")
    means = np.mean(features, axis=0)
    scales = np.maximum(np.std(features, axis=0), 1e-3)
    standardized = (features - means) / scales
    design = np.column_stack((standardized, np.ones(len(standardized))))
    reliability = (
        np.ones(len(labels), dtype=np.float64) if reliability is None else reliability
    )
    positive_mass = max(float(np.sum(reliability[labels == 1])), 1e-6)
    negative_mass = max(float(np.sum(reliability[labels == 0])), 1e-6)
    sample_weights = reliability * np.where(
        labels == 1,
        0.5 / positive_mass,
        0.5 / negative_mass,
    )
    parameters = np.zeros(design.shape[1], dtype=np.float64)
    penalty = np.eye(design.shape[1], dtype=np.float64) * regularization
    penalty[-1, -1] = 0.0
    for _ in range(iterations):
        logits = np.clip(design @ parameters, -30.0, 30.0)
        probabilities = 1.0 / (1.0 + np.exp(-logits))
        gradient = design.T @ (sample_weights * (probabilities - labels))
        gradient += penalty @ parameters
        curvature = sample_weights * probabilities * (1.0 - probabilities)
        hessian = design.T @ (design * curvature[:, None]) + penalty
        step = np.linalg.solve(hessian + np.eye(len(parameters)) * 1e-9, gradient)
        parameters -= step
        if float(np.linalg.norm(step)) < 1e-7:
            break
    return CandidateModel(
        name=model_name,
        feature_names=FEATURE_NAMES,
        means=tuple(float(value) for value in means),
        scales=tuple(float(value) for value in scales),
        weights=tuple(float(value) for value in parameters[:-1]),
        bias=float(parameters[-1]),
    )


def choose_threshold(
    labels: np.ndarray,
    probabilities: np.ndarray,
    reliability: np.ndarray | None = None,
) -> float:
    reliability = (
        np.ones(len(labels), dtype=np.float64) if reliability is None else reliability
    )
    best_threshold = 0.5
    best_score = -1.0
    for threshold in np.unique(np.round(probabilities, 6)):
        predicted = probabilities >= threshold
        true_positive = float(np.sum(reliability[predicted & (labels == 1)]))
        false_positive = float(np.sum(reliability[predicted & (labels == 0)]))
        false_negative = float(np.sum(reliability[~predicted & (labels == 1)]))
        precision = true_positive / max(true_positive + false_positive, 1)
        recall = true_positive / max(true_positive + false_negative, 1)
        beta_squared = 0.25
        score = (
            (1 + beta_squared)
            * precision
            * recall
            / max(beta_squared * precision + recall, 1e-12)
        )
        if score > best_score:
            best_score = score
            best_threshold = float(threshold)
    return best_threshold
