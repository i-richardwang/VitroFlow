from __future__ import annotations

import argparse
from pathlib import Path

from vitroflow.training_recipe import load_training_recipe_manifest
from vitroflow.yolo import EpochReport, train_yolo_detector

DEFAULT_RECIPE_PATH = (
    Path(__file__).resolve().parents[1] / "configs/yolo26/seed-small.recipe.json"
)


def _positive_integer(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def format_epoch_progress(epoch: EpochReport, total_epochs: int) -> str:
    return (
        f"epoch {epoch.epoch}/{total_epochs}: "
        f"mAP50 {epoch.map50:.4f} mAP50-95 {epoch.map50_to_95:.4f}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fine-tune and validate a YOLO26 seed detector."
    )
    parser.add_argument("--data", required=True, type=Path, help="YOLO dataset YAML")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--recipe",
        type=Path,
        default=DEFAULT_RECIPE_PATH,
        help="Recipe manifest with base model, parameters, and runtime",
    )
    parser.add_argument("--epochs", type=_positive_integer)
    parser.add_argument("--imgsz", type=_positive_integer)
    parser.add_argument("--batch", type=_positive_integer)
    parser.add_argument(
        "--device",
        help="Ultralytics device such as cpu, mps, 0, or 0,1 (default: automatic)",
    )
    args = parser.parse_args(argv)

    recipe = load_training_recipe_manifest(args.recipe)
    parameters = dict(recipe.parameters)
    for name in ("epochs", "imgsz", "batch"):
        override = getattr(args, name)
        if override is not None:
            parameters[name] = override

    result = train_yolo_detector(
        args.data,
        args.output,
        parameters=parameters,
        model=recipe.base_model_reference,
        model_digest=recipe.base_model_digest,
        runtime_version=recipe.runtime_version,
        device=args.device,
        on_epoch=lambda epoch: print(
            format_epoch_progress(epoch, parameters["epochs"])
        ),
    )
    print(f"best weights: {result.best_weights}")
    print(f"inference config: {result.summary}")
    if result.confidence is None:
        print("best-F1 confidence: unavailable (validation F1 is zero)")
    else:
        print(f"best-F1 confidence: {result.confidence:.4f}")
    print(f"validation metrics: {result.metrics}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
