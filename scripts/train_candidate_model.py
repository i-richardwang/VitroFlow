from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from vitroflow.candidates import describe_candidates
from vitroflow.config import PipelineConfig
from vitroflow.evaluation import (
    LabeledCandidates,
    choose_threshold,
    combine_labeled,
    fit_logistic_model,
    label_candidates,
    load_annotations,
)
from vitroflow.geometry import estimate_geometry
from vitroflow.image_io import read_image
from vitroflow.normalization import normalize_image
from vitroflow.proposals import propose_seed_centers


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fit and evaluate the candidate confidence model."
    )
    parser.add_argument("annotations_dir", type=Path)
    parser.add_argument("--model-name", default="candidate-logistic")
    args = parser.parse_args()
    config = PipelineConfig()
    datasets: list[LabeledCandidates] = []
    complete_feature_sets: list[tuple[str, np.ndarray]] = []
    for annotation_path in sorted(args.annotations_dir.glob("*.json")):
        annotations = load_annotations(annotation_path)
        image = read_image(annotations.image_path)
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
            normalized, proposals, geometry.center, geometry.radius
        )
        labeled = label_candidates(proposals, evidence, annotations)
        datasets.append(labeled)
        complete_feature_sets.append(
            (annotations.image_key, np.vstack([item.to_array() for item in evidence]))
        )
        print(
            annotations.image_key,
            f"proposal recall {labeled.matched_positives}/{labeled.positive_count}",
            f"labeled negatives {np.sum(labeled.labels == 0)}",
            flush=True,
        )
    combined = combine_labeled(datasets)
    groups = np.unique(combined.groups)
    if len(groups) < 2:
        raise ValueError("Leave-one-image-out evaluation requires at least two images")
    probabilities = np.zeros(len(combined.labels), dtype=np.float64)
    for group in groups:
        validation = combined.groups == group
        fold_model = fit_logistic_model(
            combined.features[~validation],
            combined.labels[~validation],
            args.model_name,
            reliability=combined.weights[~validation],
        )
        probabilities[validation] = fold_model.score_features(
            combined.features[validation]
        )
    threshold = choose_threshold(
        combined.labels,
        probabilities,
        np.maximum(combined.weights, 0.05),
    )
    model = fit_logistic_model(
        combined.features,
        combined.labels,
        args.model_name,
        reliability=combined.weights,
    )
    print(f"overall proposal recall {combined.proposal_recall:.3f}")
    print(f"leave-one-image-out confidence threshold {threshold:.6f}")
    for image_key, features in complete_feature_sets:
        scores = model.score_features(features)
        print(
            image_key,
            f"eligible candidates {np.sum(scores >= threshold)}/{len(scores)}",
        )
    print(
        json.dumps(
            {"confidence_threshold": threshold, "model": model.to_dict()},
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
