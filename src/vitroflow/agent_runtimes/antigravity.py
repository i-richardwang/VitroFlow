"""Antigravity headless execution using task-bound MCP tools."""

from __future__ import annotations

import json
import math
import queue
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from vitroflow.agent_runtimes.contract import AgentInterruptedError, ToolSet
from vitroflow.agent_runtimes.mcp import TOOL_COMMAND_ENV
from vitroflow.agent_runtimes.process import (
    json_event_stream,
    query_process,
    runtime_environment,
)
from vitroflow.agent_runtimes.setup import require_antigravity_registration


@dataclass(frozen=True)
class AntigravityRuntime:
    model: str | None = None
    executable: str = "agy"
    timeout_seconds: float = 1800

    def __post_init__(self) -> None:
        if (
            (self.model is not None and not self.model.strip())
            or not math.isfinite(self.timeout_seconds)
            or self.timeout_seconds <= 0
        ):
            raise ValueError(
                "Antigravity requires a nonempty model override and a positive timeout"
            )

    def command(self) -> str:
        executable = shutil.which(self.executable)
        if executable is None:
            raise ValueError(f"Antigravity executable not found: {self.executable}")
        return executable

    def probe(self) -> dict:
        require_antigravity_registration()
        with tempfile.TemporaryDirectory(prefix="vitroflow-agy-probe-") as directory:
            try:
                version = query_process(
                    [self.command(), "--version"], directory=directory, timeout=10
                ).strip()
                selected = query_process(
                    [
                        self.command(),
                        "-p",
                        "/model",
                        "--output-format",
                        "json",
                        *(["--model", self.model] if self.model else []),
                    ],
                    directory=directory,
                    timeout=60,
                )
            except subprocess.TimeoutExpired as error:
                raise RuntimeError("Antigravity runtime discovery timed out") from error
            except subprocess.SubprocessError as error:
                raise RuntimeError(
                    "Antigravity runtime probe failed; check its login and model configuration"
                ) from error
        document = json.loads(selected)
        model = document.get("command", {}).get("data", {}).get("id")
        if (
            not version
            or document.get("status") != "SUCCESS"
            or not isinstance(model, str)
            or not model
        ):
            raise ValueError(
                "Antigravity did not report its version and selected model"
            )
        return {"runtime": "antigravity", "version": version, "model": model}

    def execute(
        self,
        prompt: str,
        directory: Path,
        *,
        descriptor: dict,
        tools: ToolSet,
        cancelled: Callable[[], bool] = lambda: False,
        tick: Callable[[], None] = lambda: None,
        completed: Callable[[], bool] = lambda: False,
    ) -> dict:
        directory.mkdir(parents=True, exist_ok=False, mode=0o700)
        require_antigravity_registration()
        environment = {
            **runtime_environment(),
            TOOL_COMMAND_ENV: json.dumps(tools.command),
        }
        command = [
            self.command(),
            "-p",
            prompt,
            "--model",
            descriptor["model"],
            "--disable-slash-commands",
            "--output-format",
            "stream-json",
            "--print-timeout",
            f"{self.timeout_seconds:g}s",
            "--log-file",
            str(directory / "cli.log"),
        ]
        with (directory / "stderr.log").open("wb") as stderr:
            process = subprocess.Popen(
                command,
                cwd=directory,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=stderr,
                start_new_session=True,
            )
            assert process.stdout is not None
            started = time.monotonic()
            terminal = None
            accepted = False
            with json_event_stream(process, directory / "events.jsonl") as events:
                ended = False
                while not ended or process.poll() is None:
                    if cancelled():
                        raise AgentInterruptedError("AI annotation cancelled")
                    # Validated checkpoints are the completion authority. Stop a
                    # runtime that keeps talking after submitting the final task.
                    if completed():
                        accepted = True
                        break
                    if time.monotonic() - started > self.timeout_seconds:
                        raise RuntimeError(
                            "Antigravity exceeded the annotation time limit"
                        )
                    tick()
                    try:
                        event = events.get(timeout=0.2)
                    except queue.Empty:
                        continue
                    if event is None:
                        ended = True
                    elif isinstance(event, Exception):
                        raise RuntimeError(
                            "Invalid Antigravity JSON event stream"
                        ) from event
                    elif event.get("event") == "result":
                        terminal = event.get("result")
                if not accepted:
                    accepted = completed()
                if not accepted and (
                    process.wait() != 0
                    or not isinstance(terminal, dict)
                    or terminal.get("status") != "SUCCESS"
                ):
                    raise RuntimeError(
                        "Antigravity did not complete; see local runtime logs and tool permissions"
                    )
                return {
                    **descriptor,
                    "elapsedSeconds": time.monotonic() - started,
                    "terminalResult": terminal,
                    "completedBySubmission": accepted,
                }
