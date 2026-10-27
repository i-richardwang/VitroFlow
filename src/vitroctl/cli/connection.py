"""Connection options shared by workbench commands."""

from __future__ import annotations

import argparse
import os

from vitroctl.models.client import WorkbenchClient


def client(args: argparse.Namespace) -> WorkbenchClient:
    server = args.server or os.environ.get("VITROFLOW_SERVER_URL")
    token = args.token or os.environ.get("VITROFLOW_API_KEY")
    if not server or not token:
        raise ValueError(
            "Set VITROFLOW_SERVER_URL and VITROFLOW_API_KEY (experiments scope), or --server and --token"
        )
    return WorkbenchClient(server, token)


def connection_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--server")
    parser.add_argument("--token")
