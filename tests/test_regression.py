import json
from pathlib import Path

import pytest

from vitroflow import count_seeds

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "images"
EXPECTED_COUNTS_PATH = FIXTURE_DIR / "expected-counts.json"


def test_local_reference_image_counts() -> None:
    if not EXPECTED_COUNTS_PATH.is_file():
        pytest.skip("local reference counts not available")

    expected = json.loads(EXPECTED_COUNTS_PATH.read_text(encoding="utf-8"))
    cases = expected.get("images")
    assert isinstance(cases, list) and cases, "expected counts must list images"

    for case in cases:
        image_path = FIXTURE_DIR / case["file"]
        assert image_path.is_file(), f"reference image not found: {case['file']}"

        result = count_seeds(image_path)

        assert result.count == case["expected_count"], image_path.name
        assert result.quality.status == "ok", image_path.name
