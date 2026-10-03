from __future__ import annotations

import cv2
import numpy as np

from vitroflow.image_geometry.dish import detect_dish_circle


def test_shared_dish_detector_locates_a_ring_without_using_a_fallback():
    image = np.full((800, 1200, 3), 255, np.uint8)
    cv2.circle(image, (600, 400), 330, (0, 0, 0), 8)
    circle = detect_dish_circle(image)
    assert circle is not None
    assert abs(circle.x - 600) < 8
    assert abs(circle.y - 400) < 8
    assert abs(circle.radius - 330) < 10
    assert detect_dish_circle(np.full_like(image, 255)) is None


def test_traditional_fallback_is_local_to_seed_geometry():
    from vitroflow.detectors.traditional.config import PipelineConfig
    from vitroflow.detectors.traditional.geometry import estimate_geometry

    image = np.full((80, 120, 3), 255, np.uint8)
    assert detect_dish_circle(image) is None
    geometry = estimate_geometry(image, PipelineConfig())
    assert geometry.used_fallback
    assert geometry.center == (60, 40)
    assert geometry.radius == 80 * 0.43
    assert geometry.dish_mask.shape == (80, 120)


def test_shared_boundary_cases_and_conservative_intersections():
    import json
    from pathlib import Path

    from vitroflow.autoannotation.geometry import dish_coverage, intersects_coverage
    from vitroflow.image_geometry.recipe import thumbnail_geometry

    cases = json.loads(
        (Path(__file__).parent / "fixtures/dish-geometry.json").read_text()
    )
    for sample in cases:
        width, height = (sample["frame"][key] for key in ("width", "height"))
        _, thumbnail_width, thumbnail_height = thumbnail_geometry(width, height)
        assert [thumbnail_width, thumbnail_height] == sample["thumbnail"]
        assert (dish_coverage(width, height, sample["circle"]) is not None) == sample[
            "valid"
        ]
    coverage = dish_coverage(1000, 800, {"x": 500, "y": 400, "radius": 300})
    assert intersects_coverage([845, 400, 855, 410], coverage)
    assert not intersects_coverage([846, 400, 856, 410], coverage)
    assert intersects_coverage([0, 0, 1, 1], None)
