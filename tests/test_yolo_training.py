import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from vitroflow.yolo import training
from vitroflow.yolo.training import best_f1_confidence, train_yolo_detector


class _Metrics:
    def __init__(self) -> None:
        self.results_dict = {"metrics/mAP50(B)": 0.4, "fitness": 0.2}
        self.curves_results = [[[0.0, 0.2, 0.4], [[0.1, 0.8, 0.2]], "Confidence", "F1"]]


def test_best_f1_confidence_reads_the_public_ultralytics_curve() -> None:
    assert best_f1_confidence(_Metrics()) == pytest.approx(0.2)


def test_best_f1_confidence_rejects_a_model_without_validation_signal() -> None:
    metrics = _Metrics()
    metrics.curves_results[0][1] = [[0.0, 0.0, 0.0]]

    assert best_f1_confidence(metrics) is None


def test_training_publishes_validated_inference_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    instances = []

    class FakeYolo:
        def __init__(self, source: str) -> None:
            self.source = source
            self.trainer = None
            self.train_options: dict[str, object] | None = None
            self.val_options: dict[str, object] | None = None
            instances.append(self)

        def train(self, **options: object) -> None:
            self.train_options = options
            save_dir = Path(str(options["project"])) / str(options["name"])
            weights = save_dir / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"weights")
            self.trainer = SimpleNamespace(
                save_dir=save_dir,
                args=SimpleNamespace(imgsz=768, max_det=500, device="mps"),
            )

        def val(self, **options: object) -> _Metrics:
            self.val_options = options
            return _Metrics()

    monkeypatch.setattr(training, "load_yolo", lambda: FakeYolo)
    dataset = tmp_path / "dataset.yaml"
    dataset.write_text("train: images/train\nval: images/val\n")
    config = tmp_path / "train.yaml"
    config.write_text("epochs: 50\n")
    output = tmp_path / "run"

    result = train_yolo_detector(
        dataset,
        output,
        config=config,
        device="mps",
        epochs=3,
        image_size=768,
        batch_size=4,
    )

    assert result.best_weights == output / "weights" / "best.pt"
    assert result.confidence == pytest.approx(0.2)
    assert instances[0].train_options == {
        "cfg": str(config),
        "data": str(dataset),
        "project": str(tmp_path),
        "name": "run",
        "exist_ok": False,
        "epochs": 3,
        "imgsz": 768,
        "batch": 4,
        "device": "mps",
    }
    assert instances[1].val_options["end2end"] is False
    assert instances[1].val_options["device"] == "mps"
    assert json.loads(result.summary.read_text()) == {
        "schema_version": 1,
        "weights": "weights/best.pt",
        "inference": {
            "ready": True,
            "confidence": 0.2,
            "imgsz": 768,
            "max_det": 500,
            "end2end": False,
        },
        "validation": {"metrics/mAP50(B)": 0.4, "fitness": 0.2},
    }
