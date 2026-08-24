from pathlib import Path

import cv2
import numpy as np

from vitroflow import count_seeds
from vitroflow.config import PipelineConfig
from vitroflow.detection import detect_seeds
from vitroflow.features import compute_feature_maps
from vitroflow.geometry import circle_mask


def test_same_seed_is_detected_across_exposure_changes() -> None:
    config = PipelineConfig()
    image = np.full((800, 800, 3), 190, dtype=np.uint8)
    cv2.ellipse(image, (400, 400), (3, 5), 20, 0, 360, (20, 90, 170), -1)
    measurement_mask = circle_mask(image.shape[:2], (400, 400), 300)

    counts = []
    for gain in (0.55, 0.8, 1.0, 1.25, 1.6):
        exposed = np.clip(image.astype(np.float32) * gain, 0, 255).astype(np.uint8)
        features = compute_feature_maps(exposed, measurement_mask, 300, config)
        result = detect_seeds(features, measurement_mask, 300, config)
        counts.append(len(result.detections))

    assert counts == [1, 1, 1, 1, 1]


def test_neutral_highlight_is_not_a_seed() -> None:
    config = PipelineConfig()
    image = np.full((800, 800, 3), 170, dtype=np.uint8)
    cv2.ellipse(image, (330, 400), (3, 5), 25, 0, 360, (25, 85, 165), -1)
    cv2.circle(image, (500, 400), 7, (245, 245, 245), -1)
    measurement_mask = circle_mask(image.shape[:2], (400, 400), 300)

    features = compute_feature_maps(image, measurement_mask, 300, config)
    result = detect_seeds(features, measurement_mask, 300, config)

    assert len(result.detections) == 1
    assert abs(result.detections[0].x - 330) < 5


def test_touching_seeds_have_separate_centers() -> None:
    config = PipelineConfig()
    image = np.full((800, 800, 3), 180, dtype=np.uint8)
    cv2.ellipse(image, (394, 400), (2, 4), -25, 0, 360, (20, 80, 165), -1)
    cv2.ellipse(image, (406, 400), (2, 4), 25, 0, 360, (20, 80, 165), -1)
    measurement_mask = circle_mask(image.shape[:2], (400, 400), 300)

    features = compute_feature_maps(image, measurement_mask, 300, config)
    result = detect_seeds(features, measurement_mask, 300, config)

    assert len(result.detections) == 2


def test_seed_is_detected_on_a_dark_background() -> None:
    config = PipelineConfig()
    image = np.full((800, 800, 3), 45, dtype=np.uint8)
    cv2.ellipse(image, (400, 400), (3, 5), 20, 0, 360, (30, 100, 180), -1)
    measurement_mask = circle_mask(image.shape[:2], (400, 400), 300)

    features = compute_feature_maps(image, measurement_mask, 300, config)
    result = detect_seeds(features, measurement_mask, 300, config)

    assert features.foreground_polarity == 1
    assert len(result.detections) == 1


def test_unrecognizable_dish_requires_review(tmp_path: Path) -> None:
    path = tmp_path / "blank.jpg"
    cv2.imwrite(str(path), np.zeros((400, 600, 3), dtype=np.uint8))

    result = count_seeds(path)

    assert result.count == 0
    assert result.quality.status == "review_required"
    assert "dish_detection_failed" in result.quality.warnings
    assert set(result.masks) == {
        "measurement_region",
        "bodies",
        "centers",
        "labels",
    }
