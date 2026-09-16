"""Deterministic Pi protocol fixture; never calls a model or measures vision."""

import json
import os
import sys
import time
from pathlib import Path

if "--version" in sys.argv:
    print("test-version")
    sys.exit()
model = (
    sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "test/vision"
)
if "rpc" in sys.argv:
    command = json.loads(sys.stdin.readline())
    print(
        json.dumps(
            {
                "id": command["id"],
                "type": "response",
                "success": True,
                "data": {
                    "model": {
                        "provider": "test",
                        "id": model.removeprefix("test/"),
                        "input": ["text"]
                        if model == "test/no-vision"
                        else ["text", "image"],
                    }
                },
            }
        ),
        flush=True,
    )
    sys.stdin.read()
    sys.exit()
prompt = sys.stdin.read()
Path("environment.json").write_text(
    json.dumps(
        {
            key: value
            for key, value in os.environ.items()
            if key.startswith("VITROFLOW_")
        }
    )
)
Path("arguments.json").write_text(json.dumps(sys.argv[1:]))
if model == "test/wait":
    Path("pid").write_text(str(os.getpid()))
    time.sleep(60)
if model == "test/error":
    print(
        json.dumps(
            {
                "type": "message_end",
                "message": {"role": "assistant", "stopReason": "error"},
            }
        )
    )
    sys.exit()
if model == "test/invalid-stream":
    print("invalid JSON")
    sys.exit()
if model != "test/incomplete":
    from vitroflow.agent_annotation.tools import AnnotationTools

    command = json.loads(Path("tools.json").read_text())["command"]
    tools = AnnotationTools(Path(command[command.index("--config") + 1]))
    task = tools.task
    tools.call("annotation_view", {"taskId": task["id"]})
    preview = tools.call("annotation_preview", {"taskId": task["id"], "instances": []})
    proposal = json.loads(preview["content"][0]["text"])["proposalId"]
    tools.call("annotation_submit", {"taskId": task["id"], "proposalId": proposal})
if model == "test/linger":
    time.sleep(60)
print(
    json.dumps(
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "provider": "test",
                "model": model,
                "stopReason": "stop",
                "usage": {"input": 2, "output": 3},
            },
        }
    )
)
