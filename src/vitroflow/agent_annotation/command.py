"""Command-line entry for a supervised annotation run."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from vitroflow.agent_annotation.runner import run_annotation
from vitroflow.agent_runtimes.config import RUNTIME_NAMES, RuntimeConfig
from vitroflow.agent_runtimes.setup import register_antigravity
from vitroflow.autoannotation.command import (
    add_configuration_arguments,
    configuration_from_args,
)


def _handle(args: argparse.Namespace) -> int:
    report = run_annotation(
        Path(args.image),
        Path(args.output),
        RuntimeConfig(args.runtime, args.model, args.executable, args.timeout).create(),
        prelabels=Path(args.prelabels) if args.prelabels else None,
        config=configuration_from_args(args),
        crop=args.crop,
        progress=lambda done, total: print(
            f"{done}/{total} tasks accepted", file=sys.stderr
        ),
    )
    print(json.dumps(report, indent=2))
    return 0


def _setup(_args: argparse.Namespace) -> int:
    for path in register_antigravity():
        print(f"Configured {path}")
    return 0


def add_agent_annotation_commands(commands: argparse._SubParsersAction) -> None:
    setup = commands.add_parser(
        "setup", help="Register external annotation tools with a runtime"
    )
    setup.add_argument("--runtime", choices=("antigravity",), required=True)
    setup.set_defaults(handler=_setup)
    command = commands.add_parser(
        "run", help="Run an external agent and collect one complete image annotation"
    )
    command.add_argument("--image", required=True)
    command.add_argument("--output", required=True, help="New execution directory")
    command.add_argument(
        "--model", help="Override the selected runtime’s default model"
    )
    command.add_argument("--runtime", choices=RUNTIME_NAMES, default="pi")
    command.add_argument("--executable", help="Runtime executable path")
    command.add_argument("--timeout", type=float, default=1800)
    command.add_argument("--prelabels")
    add_configuration_arguments(command)
    command.add_argument("--crop", nargs=4, type=int)
    command.set_defaults(handler=_handle)
