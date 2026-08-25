from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from vitroflow.candidates import FEATURE_NAMES, describe_candidates
from vitroflow.config import PipelineConfig
from vitroflow.evaluation import (
    LabeledCandidates,
    combine_labeled,
    fit_review_model,
    label_review_candidates,
    load_review,
)
from vitroflow.geometry import estimate_geometry
from vitroflow.image_io import read_image
from vitroflow.normalization import normalize_image
from vitroflow.proposals import propose_seed_centers
from vitroflow.scoring import BASE_MODEL, CandidateModel


@dataclass(frozen=True)
class ModelSelection:
    bandwidth: float
    regularization: float
    precision: float
    recall: float
    eligible_ratio: float
    maximum_image_drift: float
    score: float


def _f_score(precision: float, recall: float, beta: float = 0.5) -> float:
    beta_squared = beta**2
    return (
        (1.0 + beta_squared)
        * precision
        * recall
        / max(beta_squared * precision + recall, 1e-12)
    )


def _validation_scores(
    labeled: LabeledCandidates,
    threshold: float,
    bandwidth: float,
    regularization: float,
) -> np.ndarray:
    probabilities = np.zeros(len(labeled.labels), dtype=np.float64)
    for group in np.unique(labeled.groups):
        validation = labeled.groups == group
        model = fit_review_model(
            labeled.features[~validation],
            labeled.labels[~validation],
            BASE_MODEL,
            threshold,
            bandwidth,
            regularization,
        )
        probabilities[validation] = model.score_features(labeled.features[validation])
    return probabilities


def _eligible_counts(
    model: CandidateModel,
    complete_features: list[np.ndarray],
    threshold: float,
) -> list[int]:
    return [
        int(np.sum(model.score_features(features) >= threshold))
        for features in complete_features
    ]


def _select_model(
    labeled: LabeledCandidates,
    complete_features: list[np.ndarray],
    threshold: float,
) -> ModelSelection:
    baseline_counts = _eligible_counts(BASE_MODEL, complete_features, threshold)
    baseline_count = sum(baseline_counts)
    selections: list[ModelSelection] = []
    for bandwidth in (0.75, 1.0, 1.5, 2.0, 3.0):
        for regularization in (0.3, 1.0, 3.0, 10.0):
            probabilities = _validation_scores(
                labeled,
                threshold,
                bandwidth,
                regularization,
            )
            predicted = probabilities >= threshold
            true_positive = int(np.sum(predicted & (labeled.labels == 1)))
            false_positive = int(np.sum(predicted & (labeled.labels == 0)))
            false_negative = int(np.sum(~predicted & (labeled.labels == 1)))
            precision = true_positive / max(true_positive + false_positive, 1)
            recall = true_positive / max(true_positive + false_negative, 1)
            model = fit_review_model(
                labeled.features,
                labeled.labels,
                BASE_MODEL,
                threshold,
                bandwidth,
                regularization,
            )
            eligible_counts = _eligible_counts(model, complete_features, threshold)
            eligible_ratio = sum(eligible_counts) / max(baseline_count, 1)
            maximum_image_drift = max(
                abs(current - baseline) / max(baseline, 1)
                for current, baseline in zip(
                    eligible_counts,
                    baseline_counts,
                    strict=True,
                )
            )
            excess_drift = max(maximum_image_drift - 0.25, 0.0)
            score = _f_score(precision, recall) - 1.5 * excess_drift
            selections.append(
                ModelSelection(
                    bandwidth,
                    regularization,
                    precision,
                    recall,
                    eligible_ratio,
                    maximum_image_drift,
                    score,
                )
            )
    return max(selections, key=lambda selection: selection.score)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fit seedness calibration from partial image reviews."
    )
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("calibration_dir", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/vitroflow/candidate_model.json"),
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path("."),
        help="Directory that result source paths are relative to",
    )
    args = parser.parse_args()
    calibration_paths = sorted(args.calibration_dir.glob("*.json"))
    if not calibration_paths:
        parser.error(f"No review files found in {args.calibration_dir}")

    config = PipelineConfig()
    datasets: list[LabeledCandidates] = []
    complete_features: list[np.ndarray] = []
    for calibration_path in calibration_paths:
        result_path = args.run_dir / calibration_path.name
        if not result_path.is_file():
            parser.error(f"Missing run result: {result_path}")
        review = load_review(calibration_path, result_path)
        image = read_image(args.data_root / review.image_path)
        geometry = estimate_geometry(image, config)
        normalized = normalize_image(image, geometry.reference_mask, geometry.radius)
        proposals = propose_seed_centers(
            normalized,
            geometry.reference_mask,
            geometry.search_mask,
            geometry.radius,
            config.proposals,
        )
        evidence = describe_candidates(
            normalized,
            proposals,
            geometry.center,
            geometry.radius,
        )
        labeled = label_review_candidates(proposals, evidence, review)
        datasets.append(labeled)
        complete_features.append(
            np.vstack([item.to_array() for item in evidence])
            if evidence
            else np.empty((0, len(FEATURE_NAMES)), dtype=np.float64)
        )
        print(
            review.image_key,
            f"proposal recall {labeled.matched_seeds}/{labeled.seed_count}",
            flush=True,
        )

    combined = combine_labeled(datasets)
    if len(np.unique(combined.groups)) < 2:
        parser.error("Model selection requires at least two reviewed images")
    selection = _select_model(
        combined,
        complete_features,
        config.decision.confidence_threshold,
    )
    model = fit_review_model(
        combined.features,
        combined.labels,
        BASE_MODEL,
        config.decision.confidence_threshold,
        selection.bandwidth,
        selection.regularization,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(model.to_dict(), indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"overall proposal recall {combined.proposal_recall:.3f}")
    print(
        "leave-one-image-out",
        f"precision {selection.precision:.3f}",
        f"recall {selection.recall:.3f}",
    )
    print(
        "selected calibration",
        f"bandwidth {selection.bandwidth:g}",
        f"regularization {selection.regularization:g}",
        f"eligible ratio {selection.eligible_ratio:.3f}",
        f"maximum image drift {selection.maximum_image_drift:.3f}",
    )
    print(args.output)


if __name__ == "__main__":
    main()
