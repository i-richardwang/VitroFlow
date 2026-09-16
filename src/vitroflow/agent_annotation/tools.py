"""Model-facing annotation operations and their local transports."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
from pathlib import Path
from uuid import uuid4

from jsonschema import Draft202012Validator

from vitroflow.agent_annotation.coordinator import request
from vitroflow.autoannotation import tasks
from vitroflow.autoannotation.instructions import task_instruction
from vitroflow.autoannotation.protocol import (
    digest,
    object_digest,
    validate_edges,
    validate_response,
)
from vitroflow.autoannotation.rendering import preview as render_preview
from vitroflow.autoannotation.rendering import references
from vitroflow.autoannotation.storage import read_json, write_json

COORDINATE_SPACE = "box_2d: [ymin, xmin, ymax, xmax], normalized 0–1000"
BOX = {
    "type": "array",
    "items": {"type": "number", "minimum": 0, "maximum": 1000},
    "minItems": 4,
    "maxItems": 4,
    "description": COORDINATE_SPACE,
}


def object_schema(properties: dict, required: list[str]) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


RESPONSE = object_schema(
    {
        "taskId": {"type": "string"},
        "instances": {
            "type": "array",
            "items": object_schema(
                {
                    "id": {"type": "string"},
                    "class": {"type": "string"},
                    "box_2d": BOX,
                    "uncertain": {"type": "boolean"},
                    "truncated": {"type": "boolean"},
                },
                ["id", "class", "box_2d"],
            ),
        },
        "issues": {
            "type": "array",
            "items": object_schema(
                {"box_2d": BOX, "reason": {"type": "string"}}, ["box_2d", "reason"]
            ),
        },
    },
    ["taskId", "instances"],
)
SUBMISSION = object_schema(
    {
        "taskId": {"type": "string"},
        "proposalId": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
    },
    ["taskId", "proposalId"],
)
DEFINITIONS = tuple(
    {"name": f"annotation_{name}", "description": description, "inputSchema": schema}
    for name, description, schema in (
        (
            "view",
            "View OVERVIEW, CLEAN and optional INITIAL reference images, with task-specific instructions. Estimate box edges visually; previous coordinates are not supplied.",
            object_schema({"taskId": {"type": "string"}}, ["taskId"]),
        ),
        (
            "preview",
            "Preview all instances using normalized box_2d edges. Omit issues when none. Returns CLEAN, PROPOSED and a proposalId for submission.",
            RESPONSE,
        ),
        (
            "submit",
            "Accept a previously previewed proposal by its proposalId. Do not repeat coordinates.",
            SUBMISSION,
        ),
    )
)


def text(value: dict) -> dict:
    return {"type": "text", "text": json.dumps(value)}


def image(path: Path) -> dict:
    return {
        "type": "image",
        "data": base64.b64encode(path.read_bytes()).decode(),
        "mimeType": "image/png",
    }


class AnnotationTools:
    def __init__(self, config: Path):
        settings = read_json(config)
        self.package = Path(settings["package"])
        self.producer = settings["producer"]
        self.directory = config.parent / "responses"
        self.settings = settings
        self.manifest = tasks.read_manifest(self.package)
        if self.manifest["packageId"] != settings["packageId"]:
            raise ValueError("Task input identity mismatch")
        self.task = tasks.task_by_id(self.manifest, settings["taskId"])

    def asset(self, relative: str) -> Path:
        path = self.package / relative
        if digest(path.read_bytes()) != self.manifest["assets"][relative]:
            raise ValueError(f"Frozen asset changed: {relative}")
        return path

    def call(self, name: str, arguments: dict) -> dict:
        definition = next((item for item in DEFINITIONS if item["name"] == name), None)
        if definition is None:
            raise ValueError("Unknown annotation operation")
        Draft202012Validator(definition["inputSchema"]).validate(arguments)
        task = self.task
        if arguments["taskId"] != task["id"]:
            raise ValueError("Tool is bound to a different task")
        if name == "annotation_submit":
            receipt = request(
                self.settings["endpoint"],
                {
                    "operation": "submit",
                    "taskId": task["id"],
                    "attemptId": self.settings["attemptId"],
                    "proposalId": arguments["proposalId"],
                },
            )
            return {"content": [text(receipt)], "complete": True}
        metadata = {
            "id": task["id"],
            "displaySize": task["displaySize"],
            "coordinateSpace": COORDINATE_SPACE,
        }
        width, height = task["displaySize"]
        relative = f"tasks/{task['id']}"
        folder = self.package / relative
        if name == "annotation_view":
            items = references(
                read_json(self.asset(f"{relative}/prelabels.json"))["instances"]
            )
            content = [
                text(
                    {
                        "task": metadata,
                        "mode": "refit" if items else "annotate",
                        "instructions": task_instruction(bool(items)),
                        "references": [
                            {"id": i["id"], "class": i["class"]} for i in items
                        ],
                    }
                ),
                text(
                    {
                        "imageRole": "OVERVIEW — full original image; red rectangle locates CLEAN. Use for spatial context only. Annotate only CLEAN; all coordinates refer to CLEAN."
                    }
                ),
                image(self.asset(f"{relative}/overview.png")),
                text({"imageRole": "CLEAN — image evidence"}),
                image(self.asset(f"{relative}/clean.png")),
            ]
            if items:
                content.extend(
                    [
                        text({"imageRole": "INITIAL — previous annotation references"}),
                        image(self.asset(f"{relative}/before.png")),
                    ]
                )
            return {"content": content}

        def pixels(item: dict) -> dict:
            top, left, bottom, right = item["box_2d"]
            if not (0 <= top < bottom <= 1000 and 0 <= left < right <= 1000):
                raise ValueError(
                    "box_2d edges must be finite, ordered and within 0–1000"
                )
            return {
                **{k: v for k, v in item.items() if k != "box_2d"},
                "bbox": {
                    "x": left * width / 1000,
                    "y": top * height / 1000,
                    "width": (right - left) * width / 1000,
                    "height": (bottom - top) * height / 1000,
                },
            }

        response = {
            "schemaVersion": self.manifest["schemaVersion"],
            "packageId": self.manifest["packageId"],
            "taskId": task["id"],
            "producer": self.producer,
            "instances": [pixels(i) for i in arguments["instances"]],
            "issues": [pixels(i) for i in arguments.get("issues", [])],
        }
        attempt = self.directory / uuid4().hex
        attempt.mkdir(parents=True)
        write_json(attempt / "response.json", response)
        if name == "annotation_preview":
            validate_response(response, self.manifest, task)
            validate_edges(response, self.manifest, task)
            self.asset(f"{relative}/clean.png")
            if (folder / "before.png").exists():
                self.asset(f"{relative}/before.png")
            render_preview(self.package, task, response, attempt / "preview")
            proposal_id = object_digest(response)
            write_json(self.directory / "proposals" / f"{proposal_id}.json", response)
            return {
                "content": [
                    text({**metadata, "proposalId": proposal_id}),
                    text({"imageRole": "CLEAN — image evidence"}),
                    image(attempt / "preview/clean.png"),
                    text({"imageRole": "PROPOSED — your current boxes"}),
                    image(attempt / "preview/proposed.png"),
                ]
            }
        raise ValueError("Unknown annotation operation")


async def serve(tools: AnnotationTools) -> None:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import CallToolResult, ImageContent, TextContent, Tool

    server = Server("vitroflow-annotation")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [Tool(**definition) for definition in DEFINITIONS]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> CallToolResult:
        result = await asyncio.to_thread(tools.call, name, arguments)
        return CallToolResult(
            content=[
                ImageContent(**item) if item["type"] == "image" else TextContent(**item)
                for item in result["content"]
            ]
        )

    async with stdio_server() as (reader, writer):
        await server.run(reader, writer, server.create_initialization_options())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("transport", choices=("invoke", "stdio"))
    args = parser.parse_args()
    tools = AnnotationTools(args.config)
    if args.transport == "stdio":
        asyncio.run(serve(tools))
    else:
        request = json.load(sys.stdin)
        print(json.dumps(tools.call(request["name"], request["arguments"])))


if __name__ == "__main__":
    main()
