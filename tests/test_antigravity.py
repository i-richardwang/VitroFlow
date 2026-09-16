"""Runtime and native MCP boundary tests; these do not measure model accuracy."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from vitroflow.agent_annotation.runner import run_annotation
from vitroflow.agent_annotation.tools import AnnotationTools
from vitroflow.agent_runtimes.antigravity import AntigravityRuntime
from vitroflow.agent_runtimes.contract import AgentInterruptedError, ToolSet
from vitroflow.autoannotation.preparation import prepare
from vitroflow.autoannotation.storage import read_json, write_json


@pytest.fixture
def agy(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "vitroflow.agent_runtimes.antigravity.require_antigravity_registration",
        lambda: None,
    )
    executable = tmp_path / "agy fixture"
    executable.write_text(
        f"#!{sys.executable}\n"
        + (Path(__file__).parent / "fixtures/antigravity_runtime.py").read_text()
    )
    executable.chmod(0o700)
    return str(executable)


@pytest.fixture
def photo(tmp_path):
    source = tmp_path / "image.png"
    cv2.imwrite(str(source), np.full((80, 160, 3), 128, np.uint8))
    return source


@pytest.mark.parametrize("model", [None, "test/linger"])
def test_antigravity_collects_and_stops_after_final_submission(
    agy, photo, tmp_path, monkeypatch, model
):
    monkeypatch.setenv("VITROFLOW_WORKER_TOKEN", "not-inherited")
    runtime = AntigravityRuntime(model, agy, 10)
    report = run_annotation(
        photo, tmp_path / "run", runtime, config={"coreSize": 64, "halo": 16}
    )
    assert report["execution"]["runtime"] == "antigravity"
    assert read_json(tmp_path / "run/result/result.json")["coverage"]["fullImage"]
    assert (
        read_json(
            next((tmp_path / "run/attempts").glob("*/*/runtime/environment.json"))
        )
        == {}
    )
    args = json.loads(
        (
            next((tmp_path / "run/attempts").glob("*/*/runtime/arguments.json"))
        ).read_text()
    )
    assert "--dangerously-skip-permissions" not in args
    assert args[args.index("--model") + 1] == (model or "test/vision")
    pid = int((next((tmp_path / "run/attempts").glob("*/*/runtime/pid"))).read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


@pytest.mark.parametrize(
    "model", ["test/error", "test/invalid-stream", "test/incomplete"]
)
def test_antigravity_never_exports_incomplete_runs(agy, photo, tmp_path, model):
    with pytest.raises((RuntimeError, ValueError)):
        run_annotation(photo, tmp_path / "run", AntigravityRuntime(model, agy, 5))
    assert not (tmp_path / "run/result/result.json").exists()
    assert read_json(tmp_path / "run/status.json")["status"] == "failed"


@pytest.mark.parametrize("cancel", [False, True])
def test_antigravity_timeout_and_cancellation(agy, tmp_path, cancel):
    directory = tmp_path / "runtime"
    with pytest.raises(AgentInterruptedError if cancel else RuntimeError):
        AntigravityRuntime("test/wait", agy, 30 if cancel else 2).execute(
            "unused",
            directory,
            descriptor={
                "runtime": "antigravity",
                "version": "test",
                "model": "test/wait",
            },
            tools=ToolSet(("unused",), ()),
            cancelled=lambda: cancel and (directory / "pid").exists(),
        )
    with pytest.raises(ProcessLookupError):
        os.kill(int((directory / "pid").read_text()), 0)


def test_native_mcp_images_and_normalized_geometry(photo, tmp_path, annotation_attempt):
    package = tmp_path / "package"
    candidates = tmp_path / "candidates.json"
    write_json(
        candidates,
        {
            "image": {
                "sha256": hashlib.sha256(photo.read_bytes()).hexdigest(),
                "width": 160,
                "height": 80,
            },
            "instances": [
                {
                    "id": "previous",
                    "class": "seed",
                    "bbox": {"x": 20, "y": 10, "width": 20, "height": 10},
                }
            ],
        },
    )
    prepare(photo, package, prelabels_path=candidates, config={"displayScale": 3})
    coordinator, config = annotation_attempt(package, "transport-test")
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "vitroflow.agent_runtimes.mcp"],
        env={
            "VITROFLOW_AGENT_TOOL_COMMAND": json.dumps(
                [
                    sys.executable,
                    "-m",
                    "vitroflow.agent_annotation.tools",
                    "--config",
                    str(config),
                ]
            )
        },
    )

    async def check():
        async with (
            stdio_client(parameters) as (reader, writer),
            ClientSession(reader, writer) as client,
        ):
            await client.initialize()
            assert {t.name for t in (await client.list_tools()).tools} == {
                "annotation_view",
                "annotation_preview",
                "annotation_submit",
            }
            viewed = await client.call_tool(
                "annotation_view", {"taskId": "tile-000-000"}
            )
            assert not viewed.isError
            assert sum(v.type == "image" for v in viewed.content) == 3
            metadata = json.loads(viewed.content[0].text)
            assert metadata["mode"] == "refit"
            assert metadata["references"] == [{"id": "r001", "class": "seed"}]
            value = {
                "taskId": "tile-000-000",
                "instances": [
                    {"id": "one", "class": "seed", "box_2d": [125, 250, 625, 750]}
                ],
                "issues": [],
            }
            preview = await client.call_tool("annotation_preview", value)
            assert not preview.isError
            assert sum(v.type == "image" for v in preview.content) == 2
            rejected = await client.call_tool(
                "annotation_submit",
                {
                    **value,
                    "instances": [
                        {**value["instances"][0], "box_2d": [100, 100, 0, 0]}
                    ],
                },
            )
            assert rejected.isError
            assert not coordinator.events["tile-000-000"].is_set()
            proposal_id = json.loads(preview.content[0].text)["proposalId"]
            accepted = await client.call_tool(
                "annotation_submit",
                {"taskId": value["taskId"], "proposalId": proposal_id},
            )
            assert not accepted.isError
            assert coordinator.events["tile-000-000"].is_set()

    asyncio.run(check())
    direct = AnnotationTools(config).call("annotation_view", {"taskId": "tile-000-000"})
    assert json.loads(direct["content"][0]["text"])["task"]["displaySize"] == [480, 240]


def test_registration_is_explicit_idempotent_and_preserves_other_settings(
    tmp_path, monkeypatch
):
    from vitroflow.agent_runtimes.setup import (
        register_antigravity,
        require_antigravity_registration,
    )

    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    settings = tmp_path / ".gemini/antigravity-cli/settings.json"
    settings.parent.mkdir(parents=True)
    settings.write_text(
        json.dumps(
            {
                "model": "my-default",
                "permissions": {
                    "ask": ["command(*)"],
                    "deny": ["read_url(*)"],
                    "allow": ["command(git)"],
                },
            }
        )
    )
    with pytest.raises(ValueError, match="annotate setup"):
        require_antigravity_registration()
    config, _ = register_antigravity()
    first = config.read_bytes(), settings.read_bytes()
    register_antigravity()
    assert first == (config.read_bytes(), settings.read_bytes())
    require_antigravity_registration()
    document = read_json(settings)
    assert document["model"] == "my-default"
    assert document["permissions"]["ask"] == ["command(*)"]
    assert document["permissions"]["deny"] == ["read_url(*)"]
    assert len(document["permissions"]["allow"]) == 4
    assert settings.stat().st_mode & 0o077 == 0


def test_unbound_mcp_session_exposes_no_task_tools(monkeypatch):
    monkeypatch.delenv("VITROFLOW_AGENT_TOOL_COMMAND", raising=False)

    async def check():
        parameters = StdioServerParameters(
            command=sys.executable, args=["-m", "vitroflow.agent_runtimes.mcp"]
        )
        async with (
            stdio_client(parameters) as (reader, writer),
            ClientSession(reader, writer) as client,
        ):
            await client.initialize()
            assert (await client.list_tools()).tools == []

    asyncio.run(check())
