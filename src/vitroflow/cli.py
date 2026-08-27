from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

from .annotations import load_complete_annotations
from .artifacts import create_image_artifacts, write_image_artifacts
from .config import PipelineConfig
from .files import atomic_directory
from .prelabel import (
    PreparedImage,
    evaluate_candidate_model,
    evaluate_proposals,
    prepare_images,
    train_candidate_model,
)
from .scoring import (
    DEFAULT_MODEL,
    CandidateModel,
    load_candidate_model,
    write_candidate_model,
)
from .yolo import export_yolo_dataset

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


def _pipeline_config(path: str | None) -> PipelineConfig:
    return PipelineConfig.from_json(path) if path else PipelineConfig()


def _candidate_model(path: str | None) -> CandidateModel:
    return load_candidate_model(path) if path else DEFAULT_MODEL


def _labels_path(data_root: Path, labels: str | None) -> Path:
    return Path(labels) if labels else data_root / "labels"


def _recognize(args: argparse.Namespace) -> int:
    inputs = _collect_inputs(args.inputs)
    if not inputs:
        raise ValueError("No supported images found")
    config = _pipeline_config(args.config)
    model = _candidate_model(args.model)
    output_dir = Path(args.output)
    data_root = Path(args.data_root)
    sources = [_relative_source(image_path, data_root) for image_path in inputs]
    stems = [source.stem.casefold() for source in sources]
    if len(set(stems)) != len(stems):
        raise ValueError("Input images must have unique filename stems")
    rows: list[dict[str, str | int]] = []
    with atomic_directory(output_dir) as working:
        for image_path, source in zip(inputs, sources, strict=True):
            artifacts = create_image_artifacts(
                image_path,
                source,
                config=config,
                model=model,
            )
            write_image_artifacts(artifacts, working)
            rows.append({"image": source.as_posix(), "count": artifacts.result.count})
            print(f"{image_path}: {artifacts.result.count}")

        with (working / "counts.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["image", "count"])
            writer.writeheader()
            writer.writerows(rows)
    return 0


def _prepared_images(
    args: argparse.Namespace, config: PipelineConfig
) -> list[PreparedImage]:
    data_root = Path(args.data_root)
    annotations = load_complete_annotations(
        _labels_path(data_root, args.labels), data_root
    )
    if not annotations:
        raise ValueError("No complete annotations found")
    return prepare_images(annotations, data_root, config)


def _evaluate_prelabel(args: argparse.Namespace) -> int:
    config = _pipeline_config(args.config)
    images = _prepared_images(args, config)
    model = _candidate_model(args.model)
    report = {
        "model": {"name": model.name, "fingerprint": model.fingerprint},
        "proposal": evaluate_proposals(images).to_dict(),
        "detection": evaluate_candidate_model(model, images, config).to_dict(),
    }
    print(json.dumps(report, indent=2))
    return 0


def _train_candidate_scoring(args: argparse.Namespace) -> int:
    config = _pipeline_config(args.config)
    images = _prepared_images(args, config)
    base_model = _candidate_model(args.base_model)
    trained = train_candidate_model(images, base_model, config)
    output = Path(args.output)
    with atomic_directory(output) as working:
        model_path = working / "model.json"
        config_path = working / "config.json"
        report_path = working / "report.json"
        write_candidate_model(trained.model, model_path)
        config_path.write_text(
            json.dumps(trained.config.to_dict(), indent=2) + "\n",
            encoding="utf-8",
        )
        report_path.write_text(
            json.dumps(
                {
                    "base_model": {
                        "name": base_model.name,
                        "fingerprint": base_model.fingerprint,
                    },
                    "model": {
                        "name": trained.model.name,
                        "fingerprint": trained.model.fingerprint,
                    },
                    "config": trained.config.to_dict(),
                    "training_set": [
                        {
                            "source": image.annotation.source.as_posix(),
                            "revision": image.annotation.revision,
                            "instances": len(image.annotation.boxes),
                            "model_version_id": image.annotation.model_version_id,
                            "artifact_digest": image.annotation.artifact_digest,
                            "runtime": {
                                "adapter": image.annotation.runtime_adapter,
                                "fingerprint": image.annotation.runtime_fingerprint,
                            },
                        }
                        for image in images
                    ],
                    **trained.report.to_dict(),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    print(output / "model.json")
    print(output / "config.json")
    print(output / "report.json")
    return 0


def _export_yolo(args: argparse.Namespace) -> int:
    data_root = Path(args.data_root)
    annotations = load_complete_annotations(
        _labels_path(data_root, args.labels), data_root
    )
    manifest = export_yolo_dataset(
        annotations,
        data_root,
        args.output,
        validation_fraction=args.validation_fraction,
        seed=args.seed,
    )
    print(f"exported {len(manifest['images'])} images to {args.output}")
    return 0


def _add_pipeline_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", help="JSON file overriding pipeline parameters")


def _add_annotation_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--data-root", default="data")
    parser.add_argument(
        "--labels",
        help="Annotation directory (default: <data-root>/labels)",
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vitroflow",
        description="Recognize seeds and build detector training data.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    recognize = commands.add_parser("recognize", help="Recognize local images")
    recognize.add_argument("inputs", nargs="+", help="Image files or directories")
    recognize.add_argument("-o", "--output", required=True)
    recognize.add_argument("--data-root", default=".")
    recognize.add_argument("--model", help="Candidate model JSON")
    _add_pipeline_options(recognize)
    recognize.set_defaults(handler=_recognize)

    prelabel = commands.add_parser(
        "prelabel", help="Evaluate and train candidate scoring"
    )
    prelabel_commands = prelabel.add_subparsers(dest="prelabel_command", required=True)

    evaluate = prelabel_commands.add_parser(
        "evaluate", help="Evaluate a model on complete annotations"
    )
    _add_annotation_options(evaluate)
    _add_pipeline_options(evaluate)
    evaluate.add_argument("--model", help="Candidate model JSON")
    evaluate.set_defaults(handler=_evaluate_prelabel)

    train = prelabel_commands.add_parser(
        "train", help="Train a model from complete annotations"
    )
    _add_annotation_options(train)
    _add_pipeline_options(train)
    train.add_argument("--base-model", help="Candidate model used as the prior")
    train.add_argument(
        "--output",
        required=True,
        help="New training artifact directory",
    )
    train.set_defaults(handler=_train_candidate_scoring)

    dataset = commands.add_parser("dataset", help="Build training datasets")
    dataset_commands = dataset.add_subparsers(dest="dataset_command", required=True)
    export_yolo = dataset_commands.add_parser(
        "export-yolo", help="Export complete annotations as a YOLO dataset"
    )
    _add_annotation_options(export_yolo)
    export_yolo.add_argument("--output", required=True)
    export_yolo.add_argument("--validation-fraction", type=float, default=0.2)
    export_yolo.add_argument("--seed", type=int, default=0)
    export_yolo.set_defaults(handler=_export_yolo)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.handler(args)
    except (OSError, TypeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
