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

from vitroflow.autoannotation import tasks
from vitroflow.autoannotation.instructions import task_instruction
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
    ["taskId", "instances", "issues"],
)
DEFINITIONS = tuple(
    {"name": f"annotation_{name}", "description": description, "inputSchema": schema}
    for name, description, schema in (
        (
            "view",
            "View CLEAN and optional INITIAL reference images, with task-specific instructions. Estimate box edges visually; previous coordinates are not supplied.",
            object_schema({"taskId": {"type": "string"}}, ["taskId"]),
        ),
        (
            "preview",
            "Validate a complete proposal and view both CLEAN and PROPOSED at the same scale. Use normalized box_2d edges.",
            RESPONSE,
        ),
        (
            "submit",
            "Validate and accept a complete task proposal. Supply all instances and issues, including empty lists for empty regions.",
            RESPONSE,
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
        self.manifest = tasks.load_package(self.package)

    def call(self, name: str, arguments: dict) -> dict:
        definition = next((item for item in DEFINITIONS if item["name"] == name), None)
        if definition is None:
            raise ValueError("Unknown annotation operation")
        Draft202012Validator(definition["inputSchema"]).validate(arguments)
        task = next(
            (t for t in self.manifest["tasks"] if t["id"] == arguments["taskId"]), None
        )
        if task is None:
            raise ValueError("Unknown annotation task")
        metadata = {
            "id": task["id"],
            "displaySize": task["displaySize"],
            "coordinateSpace": COORDINATE_SPACE,
        }
        width, height = task["displaySize"]
        folder = self.package / "tasks" / task["id"]
        if name == "annotation_view":
            items = references(read_json(folder / "prelabels.json")["instances"])
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
                text({"imageRole": "CLEAN — image evidence"}),
                image(folder / "clean.png"),
            ]
            if items:
                content.extend(
                    [
                        text({"imageRole": "INITIAL — previous annotation references"}),
                        image(folder / "before.png"),
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
            "issues": [pixels(i) for i in arguments["issues"]],
        }
        attempt = self.directory / uuid4().hex
        attempt.mkdir(parents=True)
        write_json(attempt / "response.json", response)
        if name == "annotation_preview":
            tasks.preview(self.package, task["id"], response, attempt / "preview")
            return {
                "content": [
                    text(metadata),
                    text({"imageRole": "CLEAN — image evidence"}),
                    image(attempt / "preview/clean.png"),
                    text({"imageRole": "PROPOSED — your current boxes"}),
                    image(attempt / "preview/proposed.png"),
                ]
            }
        tasks.submit(self.package, task["id"], response)
        state = tasks.status(self.package)
        return {"content": [text(state)], "complete": state["complete"]}


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
