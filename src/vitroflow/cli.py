from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

from .artifacts import create_image_artifacts, write_image_artifacts
from .config import PipelineConfig

SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}


def _relative_source(image_path: Path, data_root: Path) -> Path:
    try:
        return Path(os.path.abspath(image_path)).relative_to(os.path.abspath(data_root))
    except ValueError:
        raise ValueError(f"{image_path} is outside the data root {data_root}") from None


def _collect_inputs(paths: list[str]) -> list[Path]:
    inputs: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            inputs.extend(
                child
                for child in sorted(path.iterdir())
                if child.is_file() and child.suffix.lower() in SUPPORTED_SUFFIXES
            )
        elif path.is_file():
            inputs.append(path)
        else:
            raise FileNotFoundError(path)
    return inputs


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vitroflow",
        description="Count seeds in petri-dish photographs.",
    )
    parser.add_argument("inputs", nargs="+", help="Image files or directories")
    parser.add_argument("-o", "--output", default="output", help="Output directory")
    parser.add_argument("--config", help="JSON file overriding pipeline parameters")
    parser.add_argument(
        "--data-root",
        default=".",
        help="Directory that result source paths are recorded relative to",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        inputs = _collect_inputs(args.inputs)
        if not inputs:
            raise ValueError("No supported images found")
        config = (
            PipelineConfig.from_json(args.config) if args.config else PipelineConfig()
        )
        output_dir = Path(args.output)
        data_root = Path(args.data_root)
        rows: list[dict[str, str | int]] = []
        for image_path in inputs:
            source = _relative_source(image_path, data_root)
            artifacts = create_image_artifacts(image_path, source, config)
            write_image_artifacts(artifacts, output_dir)
            rows.append({"image": str(image_path), "count": artifacts.result.count})
            print(f"{image_path}: {artifacts.result.count}")

        with (output_dir / "counts.csv").open(
            "w", newline="", encoding="utf-8"
        ) as handle:
            writer = csv.DictWriter(handle, fieldnames=["image", "count"])
            writer.writeheader()
            writer.writerows(rows)
        return 0
    except (FileNotFoundError, TypeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
