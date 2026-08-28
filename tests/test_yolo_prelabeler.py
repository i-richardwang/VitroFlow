from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from vitroflow.inference_models import ModelManifest, ModelStore
from vitroflow.prelabelers import PredictionProducer, YoloPrelabeler
from vitroflow.prelabelers import yolo as yolo_module

PARAMETERS = {
    "epochs": 50,
    "patience": 20,
    "batch": 8,
    "imgsz": 1024,
    "optimizer": "AdamW",
    "lr0": 0.001,
    "warmup_epochs": 3.0,
    "mosaic": 0.0,
    "mixup": 0.0,
    "copy_paste": 0.0,
    "max_det": 500,
    "seed": 0,
    "deterministic": True,
}


class _Tensor:
    def __init__(self, values: list[float] | list[list[float]]) -> None:
        self._values = np.asarray(values, dtype=float)

    def cpu(self) -> _Tensor:
        return self

    def numpy(self) -> np.ndarray:
        return self._values


def _run(tmp_path: Path, *, ready: bool = True) -> Path:
    run = tmp_path / "run"
    weights = run / "weights"
    weights.mkdir(parents=True)
    (weights / "best.pt").write_bytes(b"weights")
    (run / "inference.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "weights": "weights/best.pt",
                "inference": {
                    "ready": ready,
                    "confidence": 0.42 if ready else None,
                    "imgsz": 768,
                    "max_det": 500,
                    "end2end": False,
                },
                "validation": {
                    "precision": 0.6,
                    "recall": 0.5,
                    "map50": 0.7,
                    "map50_95": 0.4,
                    "fitness": 0.43,
                },
                "training": {
                    "base_model": {
                        "reference": "yolo26n.pt",
                        "digest": "a" * 64,
                    },
                    "parameters": PARAMETERS,
                    "runtime": {
                        "framework": "ultralytics",
                        "version": "8.4.131",
                    },
                },
            }
        )
    )
    return run


def test_yolo_prelabeler_uses_published_inference_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeYolo:
        def __init__(self, weights: str) -> None:
            self.weights = weights

        def predict(self, **options: object) -> list[object]:
            calls.append((self.weights, options))
            boxes = SimpleNamespace(
                xyxy=_Tensor(
                    [
                        [-2, 5, 12, 25],
                        [30, 40, 35, 45],
                        [99, 79, 105, 90],
                    ]
                ),
                conf=_Tensor([0.9, 0.8, 0.7]),
                cls=_Tensor([0, 1, 0]),
            )
            return [SimpleNamespace(orig_shape=(80, 100), boxes=boxes)]

    monkeypatch.setattr(yolo_module, "load_yolo", lambda: FakeYolo)
    prelabeler = YoloPrelabeler.from_run(_run(tmp_path), device="mps")
    producer = PredictionProducer(
        "set.yolo-v1", prelabeler.artifact_digest, prelabeler.runtime
    )

    result = prelabeler.predict(tmp_path / "source.jpg", "c" * 64, producer)

    assert prelabeler.runtime.adapter == "ultralytics"
    assert result.producer == producer
    assert calls == [
        (
            str(tmp_path / "run" / "weights" / "best.pt"),
            {
                "source": str(tmp_path / "source.jpg"),
                "conf": 0.42,
                "imgsz": 768,
                "max_det": 500,
                "end2end": False,
                "classes": [0],
                "verbose": False,
                "device": "mps",
            },
        )
    ]
    assert [instance.to_dict() for instance in result.instances] == [
        {
            "id": "0",
            "class": "seed",
            "bbox": {"x": 0.0, "y": 5.0, "width": 12.0, "height": 20.0},
            "score": 0.9,
        },
        {
            "id": "1",
            "class": "seed",
            "bbox": {"x": 99.0, "y": 79.0, "width": 1.0, "height": 1.0},
            "score": 0.7,
        },
    ]


def test_yolo_prelabeler_rejects_an_uncalibrated_run(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="not ready"):
        YoloPrelabeler.from_run(_run(tmp_path, ready=False))


def test_yolo_fingerprint_covers_weights_and_inference_settings(tmp_path: Path) -> None:
    run = _run(tmp_path)
    baseline = YoloPrelabeler.from_run(run)
    document = json.loads((run / "inference.json").read_text())
    document["inference"]["confidence"] = 0.5
    (run / "inference.json").write_text(json.dumps(document))
    changed = YoloPrelabeler.from_run(run)

    assert baseline.artifact_digest != changed.artifact_digest
    assert baseline.runtime == changed.runtime


def test_inference_worker_downloads_a_published_yolo_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeYolo:
        def __init__(self, weights: str) -> None:
            self.weights = weights

    monkeypatch.setattr(yolo_module, "load_yolo", lambda: FakeYolo)
    reference = YoloPrelabeler.from_run(_run(tmp_path))
    artifact = {
        "kind": "ultralytics",
        "digest": reference.artifact_digest,
        "bytes": len(b"weights"),
        "path": "model-artifacts/set.yolo-v1/weights/best.pt",
        "inference": {
            "confidence": 0.42,
            "imageSize": 768,
            "maxDetections": 500,
            "endToEnd": False,
        },
        "validation": {
            "precision": 0.6,
            "recall": 0.5,
            "map50": 0.7,
            "map50_95": 0.4,
            "fitness": 0.43,
        },
        "training": {
            "baseModel": {
                "reference": "yolo26n.pt",
                "digest": "a" * 64,
            },
            "parameters": PARAMETERS,
            "runtime": {
                "framework": "ultralytics",
                "version": "8.4.131",
            },
        },
    }

    class Source:
        def __init__(self) -> None:
            self.requested: list[str] = []

        def weights(self, version_id: str) -> bytes:
            self.requested.append(version_id)
            return b"weights"

    source = Source()
    store = ModelStore(source, tmp_path / "worker", "cpu")

    manifest = ModelManifest.parse(
        {
            "schemaVersion": 1,
            "modelVersionId": "set.yolo-v1",
            "artifact": artifact,
        }
    )
    deployed = store.load(manifest)

    assert source.requested == ["set.yolo-v1"]
    assert store.loaded == "set.yolo-v1"
    assert store.load(manifest) is deployed
    assert deployed.artifact_digest == reference.artifact_digest
    weights = tmp_path / "worker/model-artifacts/set.yolo-v1/weights/best.pt"
    assert weights.is_file()

    store.unload()
    weights.write_bytes(b"corrupt")
    repaired = store.load(manifest)

    assert source.requested == ["set.yolo-v1", "set.yolo-v1"]
    assert repaired.artifact_digest == reference.artifact_digest
    assert weights.read_bytes() == b"weights"
