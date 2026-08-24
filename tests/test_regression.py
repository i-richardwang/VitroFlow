import json
from pathlib import Path

import pytest

from vitroflow import count_seeds

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "images"
MANIFEST_PATH = FIXTURE_DIR / "manifest.json"


def test_local_reference_image_counts() -> None:
    if not MANIFEST_PATH.is_file():
        pytest.skip("local reference manifest not available")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    cases = manifest.get("images")
    assert isinstance(cases, list) and cases, "manifest must contain images"

    for case in cases:
        image_path = FIXTURE_DIR / case["file"]
        assert image_path.is_file(), f"reference image not found: {case['file']}"

        result = count_seeds(image_path)

        assert result.count == case["expected_count"], image_path.name
        assert result.quality.status == "ok", image_path.name
