"""Command-line entry for a supervised annotation run."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from vitroflow.agent_annotation.runner import run_annotation
from vitroflow.agent_runtimes.pi import PiRuntime


def _handle(args: argparse.Namespace) -> int:
    config = json.loads(Path(args.config).read_text()) if args.config else None
    report = run_annotation(
        Path(args.image),
        Path(args.output),
        PiRuntime(args.model, args.pi, args.timeout),
        prelabels=Path(args.prelabels) if args.prelabels else None,
        config=config,
        crop=args.crop,
        progress=lambda done, total: print(
            f"{done}/{total} tasks accepted", file=sys.stderr
        ),
    )
    print(json.dumps(report, indent=2))
    return 0


def add_run_command(commands: argparse._SubParsersAction) -> None:
    command = commands.add_parser(
        "run", help="Run Pi and collect one complete image annotation"
    )
    command.add_argument("--image", required=True)
    command.add_argument("--output", required=True, help="New execution directory")
    command.add_argument(
        "--model", help="Override Pi's default model with a provider/model selector"
    )
    command.add_argument("--pi", default="pi", help="Pi executable")
    command.add_argument("--timeout", type=float, default=1800)
    command.add_argument("--prelabels")
    command.add_argument("--config")
    command.add_argument("--crop", nargs=4, type=int)
    command.set_defaults(handler=_handle)
