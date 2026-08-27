import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from vitroflow.yolo import training
from vitroflow.yolo.training import (
    YoloTrainingInterruptedError,
    best_f1_confidence,
    train_yolo_detector,
)


def test_seed_small_recipe_pins_its_configuration() -> None:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "configs/yolo26/seed-small.recipe.json").read_text())
    configuration = root / "configs/yolo26/seed-small.yaml"
    assert manifest["schemaVersion"] == 1
    assert manifest["recipe"]["configuration"] == {
        "name": configuration.name,
        "digest": hashlib.sha256(configuration.read_bytes()).hexdigest(),
    }


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


def test_training_stops_at_a_batch_boundary(tmp_path: Path, monkeypatch) -> None:
    class FakeYolo:
        def __init__(self, _source: str) -> None:
            self.callback = None

        def add_callback(self, event: str, callback) -> None:
            assert event == "on_train_batch_end"
            self.callback = callback

        def train(self, **_options: object) -> None:
            trainer = SimpleNamespace(stop=False)
            assert self.callback is not None
            self.callback(trainer)
            assert trainer.stop is True

    monkeypatch.setattr(training, "load_yolo", lambda: FakeYolo)
    monkeypatch.setattr(training, "version", lambda _: "8.4.129")
    dataset = tmp_path / "dataset.yaml"
    dataset.write_text("train: images/train\nval: images/val\n")
    config = tmp_path / "train.yaml"
    config.write_text("epochs: 50\n")
    model = tmp_path / "base.pt"
    model.write_bytes(b"base-weights")

    with pytest.raises(YoloTrainingInterruptedError, match="interrupted"):
        train_yolo_detector(
            dataset,
            tmp_path / "run",
            config=config,
            model=model,
            model_digest=hashlib.sha256(model.read_bytes()).hexdigest(),
            config_digest=hashlib.sha256(config.read_bytes()).hexdigest(),
            runtime_version="8.4.129",
            cancelled=lambda: True,
        )


def test_validation_stops_at_a_batch_boundary(tmp_path: Path, monkeypatch) -> None:
    instances = []

    class FakeYolo:
        def __init__(self, _source: str) -> None:
            self.callbacks = {}
            self.trainer = None
            instances.append(self)

        def add_callback(self, event: str, callback) -> None:
            self.callbacks[event] = callback

        def train(self, **options: object) -> None:
            save_dir = Path(str(options["project"])) / str(options["name"])
            weights = save_dir / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"weights")
            self.trainer = SimpleNamespace(
                save_dir=save_dir,
                args=SimpleNamespace(imgsz=768, max_det=500, device="cpu"),
            )

        def val(self, **_options: object) -> None:
            self.callbacks["on_val_batch_end"](SimpleNamespace())
            pytest.fail("validation must stop at the cancelled batch boundary")

    checks = 0

    def cancelled() -> bool:
        nonlocal checks
        checks += 1
        return checks >= 3

    monkeypatch.setattr(training, "load_yolo", lambda: FakeYolo)
    monkeypatch.setattr(training, "version", lambda _: "8.4.129")
    dataset = tmp_path / "dataset.yaml"
    dataset.write_text("train: images/train\nval: images/val\n")
    config = tmp_path / "train.yaml"
    config.write_text("epochs: 50\n")
    model = tmp_path / "base.pt"
    model.write_bytes(b"base-weights")

    with pytest.raises(YoloTrainingInterruptedError, match="interrupted"):
        train_yolo_detector(
            dataset,
            tmp_path / "run",
            config=config,
            model=model,
            model_digest=hashlib.sha256(model.read_bytes()).hexdigest(),
            config_digest=hashlib.sha256(config.read_bytes()).hexdigest(),
            runtime_version="8.4.129",
            cancelled=cancelled,
        )

    assert len(instances) == 2


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
    monkeypatch.setattr(training, "version", lambda _: "8.4.129")
    dataset = tmp_path / "dataset.yaml"
    dataset.write_text("train: images/train\nval: images/val\n")
    config = tmp_path / "train.yaml"
    config.write_text("epochs: 50\n")
    model = tmp_path / "base.pt"
    model.write_bytes(b"base-weights")
    output = tmp_path / "run"

    result = train_yolo_detector(
        dataset,
        output,
        config=config,
        model=model,
        model_digest=hashlib.sha256(model.read_bytes()).hexdigest(),
        config_digest=hashlib.sha256(config.read_bytes()).hexdigest(),
        runtime_version="8.4.129",
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
        "training": {
            "base_model": {
                "reference": str(model),
                "digest": hashlib.sha256(model.read_bytes()).hexdigest(),
            },
            "configuration": {
                "name": "train.yaml",
                "digest": hashlib.sha256(config.read_bytes()).hexdigest(),
            },
            "runtime": {
                "framework": "ultralytics",
                "version": "8.4.129",
            },
        },
    }
