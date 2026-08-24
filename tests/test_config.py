import json
from pathlib import Path

import pytest

from vitroflow.config import PipelineConfig


def test_config_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(
        json.dumps({"seed_score_reference_fraction": 0.8}), encoding="utf-8"
    )

    config = PipelineConfig.from_json(path)

    assert config.seed_score_reference_fraction == 0.8
    assert config.center_distance_fraction == PipelineConfig().center_distance_fraction


def test_config_rejects_unknown_fields(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"mystery": 1}), encoding="utf-8")

    with pytest.raises(ValueError, match="mystery"):
        PipelineConfig.from_json(path)
