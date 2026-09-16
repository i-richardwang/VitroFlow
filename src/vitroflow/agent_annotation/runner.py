"""One image operation: freeze tasks, run an external agent, validate checkpoints, collect."""

from __future__ import annotations

import sys
import time
from collections.abc import Callable
from pathlib import Path

from vitroflow.agent_annotation.instructions import runtime_prompt
from vitroflow.agent_annotation.tools import DEFINITIONS
from vitroflow.agent_runtimes.contract import (
    AgentInterruptedError,
    AgentRuntime,
    ToolSet,
)
from vitroflow.autoannotation.preparation import prepare
from vitroflow.autoannotation.results import collect
from vitroflow.autoannotation.storage import write_json
from vitroflow.autoannotation.tasks import load_package, status


def run_annotation(
    image: Path,
    directory: Path,
    runtime: AgentRuntime,
    *,
    prelabels: Path | None = None,
    config: dict | None = None,
    crop: list[int] | None = None,
    cancelled: Callable[[], bool] = lambda: False,
    progress: Callable[[int, int], None] = lambda _done, _total: None,
) -> dict:
    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    package = directory / "tasks"
    prepare(image, package, prelabels_path=prelabels, config=config, crop=crop)
    manifest = load_package(package)
    total = len(manifest["tasks"])
    progress(0, total)
    prompt = runtime_prompt(package, manifest)
    (directory / "prompt.txt").write_text(prompt, encoding="utf-8")
    last_poll = 0.0
    last_done = 0

    def tick() -> None:
        nonlocal last_poll, last_done
        if time.monotonic() - last_poll < 5:
            return
        last_poll = time.monotonic()
        try:
            state = status(package)
        except RuntimeError:
            return  # A short submit operation can hold the package lock.
        done = sum(task["state"] == "complete" for task in state["tasks"])
        if done != last_done:
            progress(done, total)
            last_done = done

    try:
        descriptor = runtime.probe()
        tool_directory = directory / "tools"
        tool_directory.mkdir()
        tool_config = tool_directory / "config.json"
        write_json(
            tool_config,
            {
                "package": str(package),
                "producer": f"{descriptor['runtime']}/{descriptor['model']}",
            },
        )
        tools = ToolSet(
            (
                sys.executable,
                "-m",
                "vitroflow.agent_annotation.tools",
                "--config",
                str(tool_config),
            ),
            DEFINITIONS,
        )

        def completed() -> bool:
            if not all(
                (package / "checkpoints" / f"{task['id']}.json").is_file()
                for task in manifest["tasks"]
            ):
                return False
            try:
                return status(package)["complete"] is True
            except RuntimeError:
                return False

        execution = runtime.execute(
            prompt,
            directory / "runtime",
            descriptor=descriptor,
            cancelled=cancelled,
            tick=tick,
            tools=tools,
            completed=completed,
        )
        if cancelled():
            raise AgentInterruptedError("AI annotation cancelled")
        if load_package(package) != manifest:
            raise ValueError("Agent changed the frozen annotation package")
        write_json(directory / "execution.json", execution)
        result = collect(package, directory / "result")
        progress(total, total)
        write_json(directory / "status.json", {"status": "succeeded"})
        return {"result": result, "execution": execution, "directory": str(directory)}
    except (OSError, ValueError, RuntimeError) as error:
        write_json(directory / "status.json", {"status": "failed", "error": str(error)})
        raise
