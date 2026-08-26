from __future__ import annotations

import argparse
from pathlib import Path

from vitroflow.yolo import export_prelabel_yolo_dataset


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a temporary YOLO dataset from a dataset's prelabels."
    )
    parser.add_argument(
        "--prelabels",
        required=True,
        type=Path,
        help="Prelabel directory, e.g. data/prelabels/<dataset>",
    )
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    manifest = export_prelabel_yolo_dataset(
        args.prelabels,
        args.data_root,
        args.output,
        validation_fraction=args.validation_fraction,
        seed=args.seed,
    )
    print(f"exported {len(manifest['images'])} prelabelled images to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
