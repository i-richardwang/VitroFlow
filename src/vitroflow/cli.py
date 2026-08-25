from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from .config import PipelineConfig
from .image_io import write_image
from .models import CountResult
from .pipeline import count_seeds

SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}


def _write_result(result: CountResult, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = result.source.stem
    (output_dir / f"{stem}.json").write_text(
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_image(output_dir / f"{stem}_overlay.jpg", result.overlay_bgr)
    write_image(output_dir / f"{stem}_debug.jpg", result.debug_bgr)


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
        rows: list[dict[str, str | int]] = []
        for image_path in inputs:
            result = count_seeds(image_path, config)
            _write_result(result, output_dir)
            rows.append({"image": str(image_path), "count": result.count})
            print(f"{image_path}: {result.count}")

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
