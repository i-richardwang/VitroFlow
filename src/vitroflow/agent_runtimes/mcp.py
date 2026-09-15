"""Launch the task-bound MCP command registered with an external runtime."""

from __future__ import annotations

import asyncio
import json
import os

TOOL_COMMAND_ENV = "VITROFLOW_AGENT_TOOL_COMMAND"


async def serve_unbound() -> None:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool

    server = Server("vitroflow-annotation")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return []

    async with stdio_server() as (reader, writer):
        await server.run(reader, writer, server.create_initialization_options())


def main() -> None:
    value = os.environ.get(TOOL_COMMAND_ENV)
    if value is None:
        asyncio.run(serve_unbound())
        return
    command = json.loads(value)
    if (
        not isinstance(command, list)
        or not command
        or not all(isinstance(arg, str) and arg for arg in command)
    ):
        raise SystemExit("Invalid task tool command")
    os.execv(command[0], [*command, "stdio"])


if __name__ == "__main__":
    main()
