import json
import math
from pathlib import Path
from types import SimpleNamespace

import pytest

from vitroflow.annotations import BoundingBox
from vitroflow.config import DecisionConfig, PipelineConfig
from vitroflow.prelabelers import (
    PredictionProducer,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
    RuntimeDescriptor,
    TraditionalPrelabeler,
    load_prelabel_document,
    parse_prelabel_document,
)
from vitroflow.scoring import DEFAULT_MODEL

CONTRACT_FIXTURE = Path(__file__).parent / "fixtures" / "contracts" / "prelabel.json"
PRODUCER = PredictionProducer(
    model_version_id="set.traditional-v1",
    artifact_digest="a" * 64,
    runtime=RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64),
)


def test_traditional_manifest_matches_the_default_artifact() -> None:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "configs/traditional-v1.json").read_text())
    assert manifest == {
        "schemaVersion": 1,
        "definition": "traditional-v1",
        "createdAt": "2026-08-27T00:00:00.000Z",
        "artifactDigest": TraditionalPrelabeler().artifact_digest,
    }


def test_shared_prelabel_contract() -> None:
    document = PrelabelResult(
        source=Path("images/set/example.jpg"),
        width=100,
        height=80,
        producer=PRODUCER,
        instances=(PrelabelInstance("seed-1", BoundingBox(10, 20, 8, 6), 0.9),),
        quality=PrelabelQuality("ok"),
    ).to_dict()
    fixture = json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    assert document == fixture
    assert load_prelabel_document(CONTRACT_FIXTURE).to_dict() == fixture


def test_parser_rejects_unknown_contract_fields() -> None:
    document = json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    document["unexpected"] = True
    with pytest.raises(ValueError, match="unknown unexpected"):
        parse_prelabel_document(document)


def test_traditional_prelabeler_adapts_detections_to_boxes(monkeypatch) -> None:
    config = PipelineConfig()
    prelabeler = TraditionalPrelabeler(config, DEFAULT_MODEL)
    producer = PredictionProducer(
        "set.traditional-v1", prelabeler.artifact_digest, prelabeler.runtime
    )
    result = SimpleNamespace(
        source=Path("images/set/a.jpg"),
        width=100,
        height=80,
        dish_radius=200.0,
        dish_center=(50.0, 40.0),
        detections=[SimpleNamespace(detection_id=3, x=10.0, y=12.0, score=0.91)],
        quality=SimpleNamespace(
            status="ok", warnings=(), clipped_fraction=0.01, focus_score=20.0
        ),
    )
    monkeypatch.setattr(
        "vitroflow.prelabelers.traditional.count_seeds",
        lambda *args, **kwargs: result,
    )

    document = prelabeler.predict(
        Path("a.jpg"), Path("images/set/a.jpg"), producer
    ).to_dict()

    assert document["producer"] == producer.to_dict()
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


def test_traditional_artifact_identity_covers_model_and_configuration() -> None:
    baseline = TraditionalPrelabeler()
    changed = TraditionalPrelabeler(
        PipelineConfig(decision=DecisionConfig(confidence_threshold=0.5)),
        DEFAULT_MODEL,
    )
    assert changed.artifact_digest != baseline.artifact_digest
    assert changed.runtime.adapter == baseline.runtime.adapter == "traditional"


@pytest.mark.parametrize(
    ("factory", "message"),
    [
        (lambda: PrelabelQuality("unknown"), "quality status"),
        (lambda: PrelabelQuality("ok", ("Not A Code",)), "warning code"),
        (
            lambda: PrelabelInstance("seed", BoundingBox(0, 0, 1, 1), math.inf),
            "score must be finite",
        ),
        (
            lambda: PrelabelInstance("seed", BoundingBox(0, 0, 1, 1), 1.1),
            "between zero and one",
        ),
    ],
)
def test_contract_rejects_values_the_web_cannot_accept(factory, message) -> None:
    with pytest.raises(ValueError, match=message):
        factory()


def test_result_rejects_duplicate_ids_and_out_of_bounds_boxes() -> None:
    outside = PrelabelInstance("seed-1", BoundingBox(95, 20, 8, 6), 0.9)
    with pytest.raises(ValueError, match="exceeds image bounds"):
        PrelabelResult(
            Path("images/set/example.jpg"),
            100,
            80,
            PRODUCER,
            (outside,),
            PrelabelQuality("ok"),
        )

    instance = PrelabelInstance("seed-1", BoundingBox(10, 20, 8, 6), 0.9)
    with pytest.raises(ValueError, match="Duplicate"):
        PrelabelResult(
            Path("images/set/example.jpg"),
            100,
            80,
            PRODUCER,
            (instance, instance),
            PrelabelQuality("ok"),
        )
