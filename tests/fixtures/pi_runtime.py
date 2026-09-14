"""Deterministic Pi protocol fixture; never calls a model or measures vision."""

import json
import os
import re
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
    from vitroflow.autoannotation.tasks import load_package, submit

    package = Path(re.search(r"image package at (.+)\.\n", prompt).group(1))
    manifest = load_package(package)
    for task in manifest["tasks"]:
        response = {
            "schemaVersion": manifest["schemaVersion"],
            "packageId": manifest["packageId"],
            "taskId": task["id"],
            "producer": "protocol-test",
            "instances": [],
            "issues": [],
        }
        submit(package, task["id"], response)
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
