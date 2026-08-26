import json
from pathlib import Path
from types import SimpleNamespace

from vitroflow.annotations import BoundingBox
from vitroflow.config import DecisionConfig, PipelineConfig
from vitroflow.prelabelers import (
    PrelabelerDescriptor,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
    TraditionalPrelabeler,
)
from vitroflow.scoring import DEFAULT_MODEL

CONTRACT_FIXTURE = Path(__file__).parent / "fixtures" / "contracts" / "prelabel.json"


def test_shared_prelabel_contract() -> None:
    document = PrelabelResult(
        source=Path("images/set/example.jpg"),
        width=100,
        height=80,
        producer=PrelabelerDescriptor(
            version_id="traditional-test",
            name="Traditional test",
            kind="traditional",
            fingerprint="b" * 64,
        ),
        instances=(PrelabelInstance("seed-1", BoundingBox(10, 20, 8, 6), 0.9),),
        quality=PrelabelQuality("ok"),
    ).to_dict()

    assert document == json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))


def test_traditional_prelabeler_adapts_detections_to_boxes(monkeypatch) -> None:
    config = PipelineConfig()
    prelabeler = TraditionalPrelabeler(config, DEFAULT_MODEL)
    result = SimpleNamespace(
        source=Path("images/set/a.jpg"),
        width=100,
        height=80,
        dish_radius=200.0,
        dish_center=(50.0, 40.0),
        detections=[SimpleNamespace(detection_id=3, x=10.0, y=12.0, score=0.91)],
        quality=SimpleNamespace(
            status="ok",
            warnings=(),
            clipped_fraction=0.01,
            focus_score=20.0,
        ),
    )
    monkeypatch.setattr(
        "vitroflow.prelabelers.traditional.count_seeds",
        lambda *args, **kwargs: result,
    )

    document = prelabeler.predict(Path("a.jpg"), Path("images/set/a.jpg")).to_dict()

    assert document["producer"] == prelabeler.descriptor.to_dict()
    assert document["instances"] == [
        {
            "id": "3",
            "class": "seed",
            "bbox": {"x": 7.5, "y": 9.5, "width": 5.0, "height": 5.0},
            "score": 0.91,
        }
    ]
    assert document["diagnostics"] == {
        "dish": {"center_x": 50.0, "center_y": 40.0, "radius": 200.0},
        "metrics": {
            "confidence_threshold": config.decision.confidence_threshold,
            "clipped_fraction": 0.01,
            "focus_score": 20.0,
        },
    }


def test_traditional_configuration_is_part_of_the_version_identity() -> None:
    baseline = TraditionalPrelabeler()
    changed = TraditionalPrelabeler(
        PipelineConfig(decision=DecisionConfig(confidence_threshold=0.5)),
        DEFAULT_MODEL,
    )

    assert changed.descriptor.version_id != baseline.descriptor.version_id
    assert changed.descriptor.fingerprint != baseline.descriptor.fingerprint
