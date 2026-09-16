"""Command-line interface for portable visual annotation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from vitroflow.autoannotation import preparation, results, tasks
from vitroflow.autoannotation.storage import read_json


def configuration_from_args(args: argparse.Namespace) -> dict:
    config = read_json(Path(args.config)) if args.config else {}
    config.update(
        {
            key: getattr(args, attr)
            for key, attr in (
                ("coreSize", "core_size"),
                ("halo", "halo"),
                ("displayScale", "display_scale"),
            )
            if getattr(args, attr) is not None
        }
    )
    return config


def add_configuration_arguments(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--config",
        help="JSON configuration: coreSize, halo, displayScale, classes, rules",
    )
    command.add_argument(
        "--core-size", type=int, help="Core side in source pixels (default 512)"
    )
    command.add_argument(
        "--halo", type=int, help="Context per side in source pixels (default 32)"
    )
    command.add_argument(
        "--display-scale", type=int, help="Display magnification, 1–4 (default 1)"
    )


def _handle(args: argparse.Namespace) -> int:
    command = args.annotation_command
    if command in ("prepare", "plan"):
        result = preparation.prepare(
            Path(args.image),
            Path(args.output) if command == "prepare" else None,
            crop=args.crop,
            prelabels_path=Path(args.prelabels) if args.prelabels else None,
            config=configuration_from_args(args),
            plan_only=command == "plan",
        )
    elif command == "status":
        result = tasks.status(Path(args.run))
    elif command == "preview":
        result = tasks.preview(
            Path(args.run), args.task, read_json(Path(args.file)), Path(args.output)
        )
    elif command == "submit":
        result = tasks.submit(Path(args.run), args.task, read_json(Path(args.file)))
    elif command == "fail":
        result = tasks.fail(Path(args.run), args.task, args.message)
    elif command == "reset":
        result = tasks.reset(Path(args.run), args.task)
    else:
        result = results.collect(Path(args.run), Path(args.output))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return (
        2
        if command == "status" and any(t["state"] == "invalid" for t in result["tasks"])
        else 0
    )


def add_annotation_commands(
    subcommands: argparse._SubParsersAction,
) -> None:
    for name in ("plan", "prepare"):
        command = subcommands.add_parser(
            name,
            help="Inspect workload without writing files"
            if name == "plan"
            else "Freeze portable image tasks",
        )
        command.set_defaults(handler=_handle)
        command.add_argument("--image", required=True)
        if name == "prepare":
            command.add_argument("--output", required=True, help="New task directory")
        command.add_argument(
            "--crop", nargs=4, type=int, metavar=("X", "Y", "WIDTH", "HEIGHT")
        )
        command.add_argument(
            "--prelabels",
            help="Previous result.json or source-coordinate candidate JSON",
        )
        add_configuration_arguments(command)
    for name, help_text in (
        ("status", "Inspect completion and execution errors"),
        ("preview", "Render proposed boxes without accepting them"),
        ("submit", "Validate and accept a complete response"),
        ("fail", "Record a task execution failure"),
        ("reset", "Archive a checkpoint and restart its task"),
        ("collect", "Export complete annotations and overlays"),
    ):
        command = subcommands.add_parser(name, help=help_text)
        command.set_defaults(handler=_handle)
        command.add_argument("--run", required=True)
        if name in ("preview", "submit", "fail", "reset"):
            command.add_argument("--task", required=True)
        if name in ("preview", "submit"):
            command.add_argument("--file", required=True)
        if name in ("preview", "collect"):
            command.add_argument(
                "--output", required=True, help="New directory outside the task package"
            )
        if name == "fail":
            command.add_argument("--message", required=True)
