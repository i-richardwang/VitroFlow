"""The supervisor only schedules; image and result traffic use task MCP credentials."""

import json
import threading
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from vitroflow.agent_annotation.remote import AnnotationMcpClient
from vitroflow.worker.annotation import AnnotationClient, process_annotation_job
from vitroflow.worker.session import LeaseLostError, WorkerClient, WorkerSession


@pytest.mark.parametrize(
    "outcome", ["success", "lost-submit-reply", "no-submit", "lease-lost"]
)
def test_worker_uses_remote_tools_without_downloading_or_uploading_images(
    tmp_path, monkeypatch, outcome
):
    accepted = set()
    operations = []
    tasks = ["tile-000-000", "tile-000-001", "tile-000-002"]
    descriptor = {"runtime": "pi", "version": "test", "model": "test/vision"}

    def respond(request):
        assert request.method == "POST"
        assert request.headers["Authorization"] == "Bearer worker-secret"
        body = json.loads(request.content)
        operation = body["operation"]
        operations.append(operation)
        if operation == "assign":
            if outcome == "lease-lost":
                return httpx.Response(409, text="lease lost")
            return httpx.Response(
                200,
                json={
                    "accepted": False,
                    "runId": "run",
                    "taskId": body["taskId"],
                    "endpoint": "https://lab.example/api/mcp",
                    "token": "task-" + body["taskId"],
                },
            )
        if operation == "status":
            return httpx.Response(
                200,
                json={
                    "status": "succeeded" if len(accepted) == 3 else "running",
                    "tasks": [
                        {"taskId": task, "accepted": task in accepted} for task in tasks
                    ],
                    "completed": len(accepted),
                    "total": 3,
                },
            )
        return httpx.Response(200, json={"ok": True})

    def remote_post(url, *, headers, json, **kwargs):
        assert url == "https://lab.example/api/mcp"
        assert "worker-secret" not in str(headers)
        assert kwargs["follow_redirects"] is False
        task_id = headers["Authorization"].removeprefix("Bearer task-")
        request = httpx.Request("POST", url)
        if json["method"] == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "annotation_view",
                        "description": "View",
                        "inputSchema": {"type": "object"},
                    }
                ]
            }
        else:
            assert json["params"]["arguments"]["taskId"] == task_id
            accepted.add(task_id)
            if outcome == "lost-submit-reply":
                raise httpx.ReadTimeout("Reply lost after acceptance")
            result = {"content": [{"type": "text", "text": '{"accepted":true}'}]}
        return httpx.Response(
            200, request=request, json={"jsonrpc": "2.0", "id": 1, "result": result}
        )

    monkeypatch.setattr(httpx, "post", remote_post)
    executions = []

    def execute(prompt, directory, *, tools, **kwargs):
        config_path = Path(tools.command[-1])
        config = json.loads(config_path.read_text())
        assert config_path.stat().st_mode & 0o777 == 0o600
        assert "worker-secret" not in config_path.read_text()
        assert "vitroflow.agent_annotation.remote" in tools.command
        executions.append(config["taskId"])
        if outcome != "no-submit":
            AnnotationMcpClient(config["endpoint"], config["token"]).call(
                "annotation_submit",
                {"taskId": config["taskId"], "proposalId": "abc"},
            )
        return descriptor

    runtime = SimpleNamespace(probe=lambda: descriptor, execute=execute)
    worker = WorkerClient(
        "https://lab.example",
        "worker-secret",
        WorkerSession("worker", "session", "2026-09-22T00:00:00Z", (), 1024),
        transport=httpx.MockTransport(respond),
    )
    try:
        if outcome in ("no-submit", "lease-lost"):
            with pytest.raises((RuntimeError, LeaseLostError)):
                process_annotation_job(
                    AnnotationClient(worker),
                    {"id": "run"},
                    tmp_path,
                    runtime,
                    stopped=threading.Event(),
                )
        else:
            process_annotation_job(
                AnnotationClient(worker),
                {"id": "run"},
                tmp_path,
                runtime,
                stopped=threading.Event(),
            )
            assert set(executions) == set(tasks)
            assert accepted == set(tasks)
            # Reopening a completed server run does not execute a model again.
            process_annotation_job(
                AnnotationClient(worker),
                {"id": "run"},
                tmp_path,
                runtime,
                stopped=threading.Event(),
            )
            assert len(executions) == 3
    finally:
        worker.close()
    assert "complete" not in operations and "progress" not in operations
    assert not list(tmp_path.rglob("image.avif"))
    assert not list(tmp_path.rglob("tools.json"))


def test_remote_bridge_handles_protocol_errors_and_sse(monkeypatch):
    def post(url, **kwargs):
        assert (
            kwargs["json"]["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"]
            == "2026-07-28"
        )
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            headers={"Content-Type": "text/event-stream"},
            text='data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
        )

    monkeypatch.setattr(httpx, "post", post)
    assert AnnotationMcpClient("https://lab.example/api/mcp", "task").request(
        "tools/list"
    ) == {"tools": []}


def test_python_bridge_against_real_product_mcp_service(tmp_path):
    import queue
    import shutil
    import subprocess

    bun = shutil.which("bun")
    if not bun:
        pytest.skip("Bun is required for the cross-language MCP integration test")
    root = Path(__file__).resolve().parents[1]
    if not (root / "web/node_modules").is_dir():
        pytest.skip("Install Web dependencies for the cross-language integration test")
    with (tmp_path / "service.log").open("w") as log:
        process = subprocess.Popen(
            [bun, "run", str(root / "tests/fixtures/annotation_service.ts")],
            cwd=root / "web",
            stdout=subprocess.PIPE,
            stderr=log,
            text=True,
        )
        lines = queue.Queue()
        reader = threading.Thread(
            target=lambda: lines.put(process.stdout.readline()), daemon=True
        )
        reader.start()
        try:
            binding = json.loads(lines.get(timeout=30))
            client = AnnotationMcpClient(binding["endpoint"], binding["token"])
            definitions = client.request("tools/list")["tools"]
            assert sorted(tool["name"] for tool in definitions) == [
                "annotation_preview",
                "annotation_submit",
                "annotation_view",
            ]
            identity = {"taskId": binding["taskId"]}
            viewed = client.call("annotation_view", identity)
            assert (
                len([item for item in viewed["content"] if item["type"] == "image"])
                == 2
            )
            preview = client.call("annotation_preview", {**identity, "instances": []})
            proposal_id = json.loads(preview["content"][0]["text"])["proposalId"]
            receipt = client.call(
                "annotation_submit", {**identity, "proposalId": proposal_id}
            )
            assert json.loads(receipt["content"][0]["text"])["status"] == "succeeded"
            assert (
                client.call(
                    "annotation_submit", {**identity, "proposalId": proposal_id}
                )
                == receipt
            )
            denied = client.call(
                "annotation_view",
                {"taskId": binding["taskId"].replace("tile-000-000", "tile-999-999")},
            )
            assert denied["isError"] is True
        finally:
            process.terminate()
            process.wait(timeout=10)
            process.stdout.close()
            reader.join(timeout=1)
