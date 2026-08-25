from __future__ import annotations

import argparse
import json
from pathlib import Path

from vitroflow.evaluation import prepare_annotation


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert Web review edits into point annotations."
    )
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("calibration_dir", type=Path)
    parser.add_argument("annotations_dir", type=Path)
    args = parser.parse_args()
    calibration_paths = sorted(args.calibration_dir.glob("*.json"))
    if not calibration_paths:
        parser.error(f"No calibration files found in {args.calibration_dir}")

    args.annotations_dir.mkdir(parents=True, exist_ok=True)
    for calibration_path in calibration_paths:
        result_path = args.run_dir / calibration_path.name
        if not result_path.is_file():
            parser.error(f"Missing run result: {result_path}")
        annotation = prepare_annotation(calibration_path, result_path)
        output_path = args.annotations_dir / calibration_path.name
        output_path.write_text(
            f"{json.dumps(annotation, indent=2)}\n",
            encoding="utf-8",
        )
        print(output_path)


if __name__ == "__main__":
    main()
