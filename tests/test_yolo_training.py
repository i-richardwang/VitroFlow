import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from vitroflow.yolo import training
from vitroflow.yolo.training import (
    EpochReport,
    YoloTrainingInterruptedError,
    best_f1_confidence,
    epoch_report,
    train_yolo_detector,
)

PARAMETERS = {
    "epochs": 3,
    "patience": 20,
    "batch": 4,
    "imgsz": 768,
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


def test_seed_small_recipe_fixes_every_training_argument() -> None:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "configs/yolo26/seed-small.recipe.json").read_text())
    assert manifest["schemaVersion"] == 1
    recipe = manifest["recipe"]
    assert recipe["baseModel"]["reference"] == "yolo26n.pt"
    assert recipe["runtime"] == {"framework": "ultralytics", "version": "8.4.129"}
    assert recipe["parameters"] == {
        "epochs": 50,
        "patience": 20,
        "batch": 4,
        "imgsz": 1536,
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


def _trainer_after_epoch(epoch: int) -> SimpleNamespace:
    return SimpleNamespace(
        epoch=epoch - 1,
        tloss={"box_loss": 1.5, "cls_loss": 2.25, "dfl_loss": 1.0},
        metrics={
            "metrics/precision(B)": 0.5,
            "metrics/recall(B)": 0.4,
            "metrics/mAP50(B)": 0.45,
            "metrics/mAP50-95(B)": 0.2,
            "val/box_loss": 1.6,
            "val/cls_loss": 2.4,
            "val/dfl_loss": 1.1,
            "fitness": 0.225,
        },
        fitness=0.225,
        lr={"lr/pg0": 0.001, "lr/pg1": 0.001, "lr/pg2": 0.001},
    )


def test_epoch_report_reads_the_trainer_after_validation() -> None:
    report = epoch_report(_trainer_after_epoch(7))

    assert report == EpochReport(
        epoch=7,
        train={"box": 1.5, "cls": 2.25, "dfl": 1.0},
        val={"box": 1.6, "cls": 2.4, "dfl": 1.1},
        precision=0.5,
        recall=0.4,
        map50=0.45,
        map5095=0.2,
        fitness=0.225,
        lr=0.001,
    )
    assert report.to_json()["train"] == {"box": 1.5, "cls": 2.25, "dfl": 1.0}


def test_epoch_report_rejects_non_finite_values() -> None:
    trainer = _trainer_after_epoch(1)
    trainer.metrics["metrics/mAP50(B)"] = float("nan")

    with pytest.raises(ValueError, match="non-finite mAP50"):
        epoch_report(trainer)


def _base_model(tmp_path: Path) -> tuple[Path, str]:
    model = tmp_path / "base.pt"
    model.write_bytes(b"base-weights")
    return model, hashlib.sha256(model.read_bytes()).hexdigest()


def _dataset(tmp_path: Path) -> Path:
    dataset = tmp_path / "dataset.yaml"
    dataset.write_text("train: images/train\nval: images/val\n")
    return dataset


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
    model, digest = _base_model(tmp_path)

    with pytest.raises(YoloTrainingInterruptedError, match="interrupted"):
        train_yolo_detector(
            _dataset(tmp_path),
            tmp_path / "run",
            parameters=PARAMETERS,
            model=model,
            model_digest=digest,
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
    model, digest = _base_model(tmp_path)

    with pytest.raises(YoloTrainingInterruptedError, match="interrupted"):
        train_yolo_detector(
            _dataset(tmp_path),
            tmp_path / "run",
            parameters=PARAMETERS,
            model=model,
            model_digest=digest,
            runtime_version="8.4.129",
            cancelled=cancelled,
        )

    assert len(instances) == 2


def test_training_reports_epochs_and_publishes_validated_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    instances = []

    class FakeYolo:
        def __init__(self, source: str) -> None:
            self.source = source
            self.trainer = None
            self.callbacks: dict[str, object] = {}
            self.train_options: dict[str, object] | None = None
            self.val_options: dict[str, object] | None = None
            instances.append(self)

        def add_callback(self, event: str, callback) -> None:
            self.callbacks[event] = callback

        def train(self, **options: object) -> None:
            self.train_options = options
            save_dir = Path(str(options["project"])) / str(options["name"])
            weights = save_dir / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"weights")
            for epoch in (1, 2):
                self.callbacks["on_fit_epoch_end"](_trainer_after_epoch(epoch))
            self.trainer = SimpleNamespace(
                save_dir=save_dir,
                args=SimpleNamespace(imgsz=768, max_det=500, device="mps"),
            )

        def val(self, **options: object) -> _Metrics:
            self.val_options = options
            return _Metrics()

    monkeypatch.setattr(training, "load_yolo", lambda: FakeYolo)
    monkeypatch.setattr(training, "version", lambda _: "8.4.129")
    model, digest = _base_model(tmp_path)
    dataset = _dataset(tmp_path)
    output = tmp_path / "run"
    reported: list[EpochReport] = []
    phases: list[str] = []

    result = train_yolo_detector(
        dataset,
        output,
        parameters=PARAMETERS,
        model=model,
        model_digest=digest,
        runtime_version="8.4.129",
        device="mps",
        on_training_start=lambda: phases.append("training"),
        on_epoch=reported.append,
        on_validation_start=lambda: phases.append("validating"),
    )

    assert [report.epoch for report in reported] == [1, 2]
    assert phases == ["training", "validating"]
    assert result.best_weights == output / "weights" / "best.pt"
    assert result.confidence == pytest.approx(0.2)
    assert instances[0].train_options == {
        **PARAMETERS,
        "data": str(dataset),
        "project": str(tmp_path),
        "name": "run",
        "exist_ok": False,
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
            "base_model": {"reference": str(model), "digest": digest},
            "parameters": PARAMETERS,
            "runtime": {"framework": "ultralytics", "version": "8.4.129"},
        },
    }
