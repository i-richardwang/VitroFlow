from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

import httpx

from .annotations import load_complete_annotations
from .artifacts import create_image_artifacts, write_image_artifacts
from .config import PipelineConfig
from .dataset_pull import DatasetPullError, pull_dataset
from .files import atomic_directory
from .manifest import load_dataset_manifest, manifest_path, verified_blob
from .scoring import (
    DEFAULT_MODEL,
    CandidateModel,
    load_candidate_model,
    write_candidate_model,
)
from .traditional_training import (
    PreparedImage,
    evaluate_candidate_model,
    evaluate_proposals,
    prepare_images,
    train_candidate_model,
)
from .worker_command import add_worker_commands
from .yolo import export_yolo_dataset


def _pipeline_config(path: str | None) -> PipelineConfig:
    return PipelineConfig.from_json(path) if path else PipelineConfig()


def _candidate_model(path: str | None) -> CandidateModel:
    return load_candidate_model(path) if path else DEFAULT_MODEL


def _recognize(args: argparse.Namespace) -> int:
    """Run the pipeline over a pulled dataset.

    Photographs are recognized as the workbench stores them, so a local run
    sees the same pixels a worker does.
    """
    data_root = Path(args.data_root)
    manifest = load_dataset_manifest(manifest_path(data_root, args.dataset))
    inputs = [verified_blob(data_root, image.digest) for image in manifest.images]
    if not inputs:
        raise ValueError(f"{args.dataset} holds no images")
    config = _pipeline_config(args.config)
    model = _candidate_model(args.model)
    output_dir = Path(args.output)
    rows: list[dict[str, str | int]] = []
    with atomic_directory(output_dir) as working:
        for image_path in inputs:
            artifacts = create_image_artifacts(image_path, config=config, model=model)
            write_image_artifacts(artifacts, working)
            rows.append({"image": str(image_path), "count": artifacts.result.count})
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
    labelled = load_complete_annotations(manifest_path(data_root, args.dataset))
    if not labelled:
        raise ValueError("No complete annotations found")
    return prepare_images([image.annotation for image in labelled], data_root, config)


def _evaluate_traditional(args: argparse.Namespace) -> int:
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
                            "digest": image.annotation.digest,
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


def _pull_dataset(args: argparse.Namespace) -> int:
    server_url = args.server or os.environ.get("VITROFLOW_SERVER_URL")
    token = args.token or os.environ.get("VITROFLOW_EXPORT_TOKEN")
    if not server_url or not token:
        raise ValueError(
            "dataset pull needs --server/VITROFLOW_SERVER_URL and "
            "--token/VITROFLOW_EXPORT_TOKEN"
        )
    data_root = Path(args.data_root)
    report = pull_dataset(server_url, token, args.dataset, data_root)
    print(
        f"pulled {report.images} images of {report.dataset} into {data_root}: "
        f"{report.kept} kept, {report.downloaded} downloaded, "
        f"{report.replaced} replaced"
    )
    return 0


def _export_yolo(args: argparse.Namespace) -> int:
    data_root = Path(args.data_root)
    labelled = load_complete_annotations(manifest_path(data_root, args.dataset))
    manifest = export_yolo_dataset(
        labelled,
        data_root,
        args.output,
        validation_fraction=args.validation_fraction,
        seed=args.seed,
    )
    print(f"exported {len(manifest['images'])} images to {args.output}")
    return 0


def _add_pipeline_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", help="JSON file overriding pipeline parameters")


def _add_dataset_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--dataset", required=True, help="Workbench dataset name")
    parser.add_argument("--data-root", default="data")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vitroflow",
        description="Recognize seeds and build detector training data.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    recognize = commands.add_parser(
        "recognize", help="Recognize the images of a pulled dataset"
    )
    _add_dataset_options(recognize)
    recognize.add_argument("-o", "--output", required=True)
    recognize.add_argument("--model", help="Candidate model JSON")
    _add_pipeline_options(recognize)
    recognize.set_defaults(handler=_recognize)

    traditional = commands.add_parser(
        "traditional", help="Evaluate and train candidate scoring"
    )
    traditional_commands = traditional.add_subparsers(
        dest="traditional_command", required=True
    )

    evaluate = traditional_commands.add_parser(
        "evaluate", help="Evaluate a model on complete annotations"
    )
    _add_dataset_options(evaluate)
    _add_pipeline_options(evaluate)
    evaluate.add_argument("--model", help="Candidate model JSON")
    evaluate.set_defaults(handler=_evaluate_traditional)

    train = traditional_commands.add_parser(
        "train", help="Train a model from complete annotations"
    )
    _add_dataset_options(train)
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
    pull = dataset_commands.add_parser(
        "pull", help="Download a workbench dataset into a local data directory"
    )
    _add_dataset_options(pull)
    pull.add_argument("--server", help="Workbench URL (default: VITROFLOW_SERVER_URL)")
    pull.add_argument(
        "--token",
        help="Export credential (default: VITROFLOW_EXPORT_TOKEN)",
    )
    pull.set_defaults(handler=_pull_dataset)
    export_yolo = dataset_commands.add_parser(
        "export-yolo", help="Export complete annotations as a YOLO dataset"
    )
    _add_dataset_options(export_yolo)
    export_yolo.add_argument("--output", required=True)
    export_yolo.add_argument("--validation-fraction", type=float, default=0.2)
    export_yolo.add_argument("--seed", type=int, default=0)
    export_yolo.set_defaults(handler=_export_yolo)

    add_worker_commands(commands)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.handler(args)
    except (
        OSError,
        TypeError,
        ValueError,
        RuntimeError,
        httpx.HTTPError,
        DatasetPullError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
