from __future__ import annotations

import importlib.util
from collections.abc import Callable
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import cast

from vitroflow.yolo import DetectionLosses, EpochReport


def _load_script() -> ModuleType:
    path = Path(__file__).resolve().parents[1] / "scripts" / "train_yolo.py"
    spec = importlib.util.spec_from_file_location("vitroflow_train_yolo", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _epoch() -> EpochReport:
    return EpochReport(
        epoch=2,
        train=DetectionLosses(1.0, 2.0, 0.5),
        val=DetectionLosses(1.1, 2.1, 0.6),
        precision=0.5,
        recall=0.4,
        map50=0.45,
        map50_to_95=0.2,
        fitness=0.225,
        learning_rate=0.001,
    )


def test_training_script_formats_the_canonical_epoch_report() -> None:
    script = _load_script()
    format_progress = cast(
        Callable[[EpochReport, int], str], script.format_epoch_progress
    )
    assert format_progress(_epoch(), 3) == ("epoch 2/3: mAP50 0.4500 mAP50-95 0.2000")


def test_training_script_entry_point_wires_the_epoch_callback(
    tmp_path: Path, capsys
) -> None:
    script = _load_script()
    recipe = SimpleNamespace(
        parameters={"epochs": 3, "imgsz": 768, "batch": 4},
        base_model_reference="yolo26n.pt",
        base_model_digest="a" * 64,
        runtime_version="8.4.131",
    )
    script.load_training_recipe_manifest = lambda _path: recipe

    def train(_data, output, **kwargs):
        kwargs["on_epoch"](_epoch())
        output.mkdir()
        return SimpleNamespace(
            best_weights=output / "best.pt",
            summary=output / "inference.json",
            confidence=0.75,
            metrics={"map50": 0.45},
        )

    script.train_yolo_detector = train
    main = cast(Callable[[list[str]], int], script.main)

    assert (
        main(
            [
                "--data",
                str(tmp_path / "dataset.yaml"),
                "--output",
                str(tmp_path / "run"),
            ]
        )
        == 0
    )
    output = capsys.readouterr().out
    assert "epoch 2/3: mAP50 0.4500 mAP50-95 0.2000" in output
    assert f"best weights: {tmp_path / 'run' / 'best.pt'}" in output
