from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from vitroflow.prelabelers import YoloPrelabeler
from vitroflow.prelabelers import yolo as yolo_module


class _Tensor:
    def __init__(self, values: list[list[float]]) -> None:
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
                "validation": {"metrics/mAP50(B)": 0.7},
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
            boxes = _Tensor(
                [
                    [-2, 5, 12, 25, 0.9, 0],
                    [30, 40, 35, 45, 0.8, 1],
                    [99, 79, 105, 90, 0.7, 0],
                ]
            )
            return [
                SimpleNamespace(orig_shape=(80, 100), boxes=SimpleNamespace(data=boxes))
            ]

    monkeypatch.setattr(yolo_module, "load_yolo", lambda: FakeYolo)
    prelabeler = YoloPrelabeler.from_run(
        _run(tmp_path), version_id="seed-yolo-v1", device="mps"
    )

    result = prelabeler.predict(tmp_path / "source.jpg", Path("images/set/source.jpg"))

    assert prelabeler.descriptor.kind == "yolo"
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
        YoloPrelabeler.from_run(_run(tmp_path, ready=False), version_id="seed-yolo-v1")


def test_yolo_fingerprint_covers_weights_and_inference_settings(tmp_path: Path) -> None:
    run = _run(tmp_path)
    baseline = YoloPrelabeler.from_run(run, version_id="seed-yolo-v1")
    document = json.loads((run / "inference.json").read_text())
    document["inference"]["confidence"] = 0.5
    (run / "inference.json").write_text(json.dumps(document))
    changed = YoloPrelabeler.from_run(run, version_id="seed-yolo-v2")

    assert baseline.descriptor.fingerprint != changed.descriptor.fingerprint
