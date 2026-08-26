from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from ..config import PipelineConfig
from ..scoring import CandidateModel
from .data import PreparedImage
from .evaluation import DetectionMetrics, evaluate_candidate_model

_BANDWIDTHS = (1.0, 2.0, 3.0)
_REGULARIZATIONS = (0.3, 1.0, 3.0, 10.0, 30.0)
_MAXIMUM_CALIBRATION_CENTERS = 128


@dataclass(frozen=True)
class ModelSelection:
    bandwidth: float
    regularization: float
    metrics: DetectionMetrics

    def to_dict(self) -> dict[str, object]:
        return {
            "bandwidth": self.bandwidth,
            "regularization": self.regularization,
            "metrics": self.metrics.to_dict(),
        }


@dataclass(frozen=True)
class TrainingReport:
    image_count: int
    proposal_truth: int
    proposal_matched: int
    baseline: DetectionMetrics
    cross_validation: DetectionMetrics
    training: DetectionMetrics
    bandwidth: float
    regularization: float
    selections: tuple[ModelSelection, ...]

    @property
    def proposal_recall(self) -> float:
        return self.proposal_matched / max(self.proposal_truth, 1)

    def to_dict(self) -> dict[str, object]:
        return {
            "images": self.image_count,
            "proposal": {
                "truth": self.proposal_truth,
                "matched": self.proposal_matched,
                "recall": round(self.proposal_recall, 6),
            },
            "baseline": self.baseline.to_dict(),
            "cross_validation": self.cross_validation.to_dict(),
            "training": self.training.to_dict(),
            "selected": {
                "bandwidth": self.bandwidth,
                "regularization": self.regularization,
            },
            "selections": [selection.to_dict() for selection in self.selections],
        }


@dataclass(frozen=True)
class CandidateModelTraining:
    model: CandidateModel
    report: TrainingReport


def _training_arrays(images: Sequence[PreparedImage]) -> tuple[np.ndarray, np.ndarray]:
    populated = [image for image in images if len(image.labels)]
    if not populated:
        raise ValueError("Candidate model training requires candidate proposals")
    features = np.vstack([image.features for image in populated])
    labels = np.concatenate([image.labels for image in populated])
    if set(np.unique(labels)) != {0, 1}:
        raise ValueError(
            "Candidate model training requires seed and background candidates"
        )
    return features, labels


def _balanced_weights(labels: np.ndarray) -> np.ndarray:
    positives = max(int(np.sum(labels == 1)), 1)
    negatives = max(int(np.sum(labels == 0)), 1)
    return np.where(labels == 1, 0.5 / positives, 0.5 / negatives) * len(labels)


def _calibration_indices(
    residuals: np.ndarray,
    labels: np.ndarray,
    maximum: int,
) -> np.ndarray:
    selected: list[int] = []
    quota = maximum // 2
    for label in (0, 1):
        candidates = np.flatnonzero(labels == label)
        ranked = candidates[np.argsort(-np.abs(residuals[candidates]), kind="stable")]
        selected.extend(int(index) for index in ranked[:quota])
    if len(selected) < maximum:
        remaining = np.setdiff1d(
            np.arange(len(labels)),
            np.asarray(selected, dtype=np.int64),
            assume_unique=True,
        )
        ranked = remaining[np.argsort(-np.abs(residuals[remaining]), kind="stable")]
        selected.extend(int(index) for index in ranked[: maximum - len(selected)])
    return np.asarray(selected, dtype=np.int64)


def _fit_candidate_model(
    images: Sequence[PreparedImage],
    prior: CandidateModel,
    confidence_threshold: float,
    bandwidth: float,
    regularization: float,
) -> CandidateModel:
    features, labels = _training_arrays(images)
    normalized = np.clip(
        (features - np.asarray(prior.means)) / np.asarray(prior.scales),
        -6.0,
        6.0,
    )
    design = np.column_stack([normalized, np.ones(len(normalized))])
    parameters = np.asarray((*prior.weights, prior.bias), dtype=np.float64)
    prior_parameters = parameters.copy()
    sample_weights = _balanced_weights(labels)
    penalty = np.eye(design.shape[1], dtype=np.float64)
    penalty[-1, -1] = 0.25

    for _ in range(40):
        logits = np.clip(design @ parameters, -30.0, 30.0)
        probabilities = 1.0 / (1.0 + np.exp(-logits))
        variance = np.maximum(probabilities * (1.0 - probabilities), 1e-5)
        working_response = logits + (labels - probabilities) / variance
        weights = sample_weights * variance
        system = (design.T * weights) @ design + regularization * penalty
        target = (
            design.T @ (weights * working_response)
            + regularization * penalty @ prior_parameters
        )
        updated = np.linalg.solve(system, target)
        if np.linalg.norm(updated - parameters) <= 1e-7 * (
            1.0 + np.linalg.norm(parameters)
        ):
            parameters = updated
            break
        parameters = updated

    linear_logits = design @ parameters
    boundary = np.log(confidence_threshold / (1.0 - confidence_threshold))
    targets = np.where(labels == 1, boundary + 1.5, boundary - 1.5)
    residuals = targets - linear_logits
    center_indices = _calibration_indices(
        residuals,
        labels,
        min(_MAXIMUM_CALIBRATION_CENTERS, len(labels)),
    )
    centers = normalized[center_indices]
    squared_distance = np.maximum(
        np.sum(np.square(normalized), axis=1)[:, None]
        + np.sum(np.square(centers), axis=1)[None, :]
        - 2.0 * normalized @ centers.T,
        0.0,
    )
    kernel = np.exp(-squared_distance / (2.0 * bandwidth**2))
    system = (kernel.T * sample_weights) @ kernel + regularization * np.eye(
        len(centers)
    )
    target = kernel.T @ (sample_weights * residuals)
    calibration_weights = np.linalg.solve(system, target)

    return CandidateModel(
        name="candidate-seedness",
        feature_names=prior.feature_names,
        means=prior.means,
        scales=prior.scales,
        weights=tuple(float(value) for value in parameters[:-1]),
        bias=float(parameters[-1]),
        calibration_centers=tuple(
            tuple(float(value) for value in center) for center in centers
        ),
        calibration_weights=tuple(float(value) for value in calibration_weights),
        calibration_bandwidth=bandwidth,
    )


def _cross_validate(
    images: Sequence[PreparedImage],
    prior: CandidateModel,
    config: PipelineConfig,
    bandwidth: float,
    regularization: float,
) -> DetectionMetrics:
    metrics = DetectionMetrics()
    for index, validation in enumerate(images):
        training = [image for offset, image in enumerate(images) if offset != index]
        model = _fit_candidate_model(
            training,
            prior,
            config.decision.confidence_threshold,
            bandwidth,
            regularization,
        )
        metrics += evaluate_candidate_model(model, [validation], config)
    return metrics


def train_candidate_model(
    images: Sequence[PreparedImage],
    prior: CandidateModel,
    config: PipelineConfig,
    bandwidths: Sequence[float] = _BANDWIDTHS,
    regularizations: Sequence[float] = _REGULARIZATIONS,
) -> CandidateModelTraining:
    if len(images) < 2:
        raise ValueError(
            "Candidate model selection requires at least two complete images"
        )
    if not bandwidths or not regularizations:
        raise ValueError("Candidate model selection requires parameter values")
    if any(value <= 0 for value in bandwidths):
        raise ValueError("Calibration bandwidths must be positive")
    if any(value <= 0 for value in regularizations):
        raise ValueError("Regularization values must be positive")
    selections = tuple(
        ModelSelection(
            bandwidth=bandwidth,
            regularization=regularization,
            metrics=_cross_validate(
                images,
                prior,
                config,
                bandwidth,
                regularization,
            ),
        )
        for bandwidth in bandwidths
        for regularization in regularizations
    )
    selected = min(
        selections,
        key=lambda item: (
            item.metrics.corrections_per_instance,
            -item.metrics.recall,
            -item.metrics.precision,
            item.bandwidth,
            item.regularization,
        ),
    )
    model = _fit_candidate_model(
        images,
        prior,
        config.decision.confidence_threshold,
        selected.bandwidth,
        selected.regularization,
    )
    report = TrainingReport(
        image_count=len(images),
        proposal_truth=sum(len(image.annotation.boxes) for image in images),
        proposal_matched=sum(image.matched_boxes for image in images),
        baseline=evaluate_candidate_model(prior, images, config),
        cross_validation=selected.metrics,
        training=evaluate_candidate_model(model, images, config),
        bandwidth=selected.bandwidth,
        regularization=selected.regularization,
        selections=selections,
    )
    return CandidateModelTraining(model=model, report=report)
