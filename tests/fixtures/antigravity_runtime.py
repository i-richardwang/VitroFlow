"""Deterministic Antigravity process fixture; no model requests."""

import json
import os
import sys
import time
from pathlib import Path

if "--version" in sys.argv:
    print("test-version")
    raise SystemExit()
model = (
    sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "test/vision"
)
if sys.argv[sys.argv.index("-p") + 1] == "/model":
    print(json.dumps({"status": "SUCCESS", "command": {"data": {"id": model}}}))
    raise SystemExit()
Path("pid").write_text(str(os.getpid()))
Path("environment.json").write_text(
    json.dumps(
        {
            k: v
            for k, v in os.environ.items()
            if k.startswith("VITROFLOW_") and k != "VITROFLOW_AGENT_TOOL_COMMAND"
        }
    )
)
Path("arguments.json").write_text(json.dumps(sys.argv[1:]))
if model == "test/wait":
    time.sleep(60)
if model == "test/invalid-stream":
    print("bad json", flush=True)
    time.sleep(60)
if model == "test/error":
    print(json.dumps({"event": "result", "result": {"status": "ERROR"}}))
    raise SystemExit(1)
if model != "test/incomplete":
    from vitroflow.agent_annotation.tools import AnnotationTools

    args = json.loads(os.environ["VITROFLOW_AGENT_TOOL_COMMAND"])
    tools = AnnotationTools(Path(args[args.index("--config") + 1]))
    task = tools.task["id"]
    tools.call("annotation_view", {"taskId": task})
    preview = tools.call("annotation_preview", {"taskId": task, "instances": []})
    proposal_id = json.loads(preview["content"][0]["text"])["proposalId"]
    tools.call("annotation_submit", {"taskId": task, "proposalId": proposal_id})
if model == "test/linger":
    time.sleep(60)
print(json.dumps({"event": "result", "result": {"status": "SUCCESS"}}))
