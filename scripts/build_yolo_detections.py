from __future__ import annotations

import argparse
from pathlib import Path

from vitroflow.manifest import manifest_path
from vitroflow.yolo import export_detection_yolo_dataset


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a temporary YOLO dataset from a dataset's detections."
    )
    parser.add_argument("--dataset", required=True, help="Pulled dataset name")
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    manifest = export_detection_yolo_dataset(
        manifest_path(args.data_root, args.dataset),
        args.data_root,
        args.output,
        validation_fraction=args.validation_fraction,
        seed=args.seed,
    )
    print(f"exported {len(manifest['images'])} detected images to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
