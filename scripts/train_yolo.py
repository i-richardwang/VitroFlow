from __future__ import annotations

import argparse
import json
from pathlib import Path

from vitroflow.yolo import train_yolo_detector

DEFAULT_CONFIG = (
    Path(__file__).resolve().parents[1] / "configs" / "yolo26" / "seed-small.yaml"
)
DEFAULT_RECIPE = json.loads(DEFAULT_CONFIG.with_suffix(".recipe.json").read_text())[
    "recipe"
]


def _positive_integer(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fine-tune and validate a YOLO26 seed detector."
    )
    parser.add_argument("--data", required=True, type=Path, help="YOLO dataset YAML")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", default=DEFAULT_RECIPE["baseModel"]["reference"])
    parser.add_argument("--model-digest", default=DEFAULT_RECIPE["baseModel"]["digest"])
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help="Ultralytics training configuration YAML",
    )
    parser.add_argument("--epochs", type=_positive_integer)
    parser.add_argument(
        "--config-digest", default=DEFAULT_RECIPE["configuration"]["digest"]
    )
    parser.add_argument(
        "--runtime-version", default=DEFAULT_RECIPE["runtime"]["version"]
    )
    parser.add_argument("--imgsz", type=_positive_integer)
    parser.add_argument("--batch", type=_positive_integer)
    parser.add_argument(
        "--device",
        help="Ultralytics device such as cpu, mps, 0, or 0,1 (default: automatic)",
    )
    args = parser.parse_args()

    result = train_yolo_detector(
        args.data,
        args.output,
        config=args.config,
        model=args.model,
        model_digest=args.model_digest,
        config_digest=args.config_digest,
        runtime_version=args.runtime_version,
        device=args.device,
        epochs=args.epochs,
        image_size=args.imgsz,
        batch_size=args.batch,
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
