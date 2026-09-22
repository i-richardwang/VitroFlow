"""Thin runtime bridge to the workbench's task-scoped MCP service.

There is no annotation state or geometry here. Both Pi's invoke transport and
Antigravity's stdio transport forward the server's tool definitions and replies.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import httpx

PROTOCOL_VERSION = "2026-07-28"


class AnnotationMcpClient:
    def __init__(self, endpoint: str, token: str) -> None:
        self.endpoint = endpoint
        self.token = token

    def request(self, method: str, params: dict | None = None) -> dict:
        arguments = dict(params or {})
        arguments["_meta"] = {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
        }
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json, text/event-stream",
            "mcp-method": method,
        }
        if method == "tools/call":
            headers["mcp-name"] = arguments["name"]
        # Never follow redirects carrying a task credential to another origin.
        response = httpx.post(
            self.endpoint,
            headers=headers,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": arguments},
            timeout=120,
            follow_redirects=False,
        )
        response.raise_for_status()
        if response.headers.get("content-type", "").startswith("text/event-stream"):
            messages = [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]
            message = next(
                (item for item in reversed(messages) if item.get("id") == 1), {}
            )
        else:
            message = response.json()
        if "error" in message:
            raise RuntimeError(message["error"].get("message", "MCP request failed"))
        if not isinstance(message.get("result"), dict):
            raise ValueError("MCP response has no result")  # noqa: TRY004 - invalid wire response
        return message["result"]

    def call(self, name: str, arguments: dict) -> dict:
        return self.request("tools/call", {"name": name, "arguments": arguments})


async def serve(client: AnnotationMcpClient, definitions: list[dict]) -> None:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import CallToolResult, Tool

    server = Server("vitroflow-annotation")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [Tool(**definition) for definition in definitions]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> CallToolResult:
        return CallToolResult.model_validate(
            await asyncio.to_thread(client.call, name, arguments)
        )

    async with stdio_server() as (reader, writer):
        await server.run(reader, writer, server.create_initialization_options())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("transport", choices=("invoke", "stdio"))
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    client = AnnotationMcpClient(config["endpoint"], config["token"])
    if args.transport == "stdio":
        asyncio.run(serve(client, config["definitions"]))
    else:
        import sys

        request = json.load(sys.stdin)
        result = client.call(request["name"], request["arguments"])
        if request["name"] == "annotation_submit" and not result.get("isError"):
            result["complete"] = True
        print(json.dumps(result))


if __name__ == "__main__":
    main()
