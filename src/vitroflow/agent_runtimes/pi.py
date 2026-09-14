"""Run Pi's JSON print protocol with bounded lifetime and private local artifacts."""

from __future__ import annotations

import json
import math
import os
import queue
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


class AgentInterruptedError(RuntimeError):
    """The supervisor cancelled an external agent process."""


@dataclass(frozen=True)
class PiRuntime:
    model: str | None = None
    executable: str = "pi"
    timeout_seconds: float = 1800

    def __post_init__(self) -> None:
        if (
            (self.model is not None and not self.model.strip())
            or not math.isfinite(self.timeout_seconds)
            or self.timeout_seconds <= 0
        ):
            raise ValueError(
                "Pi requires a nonempty model override and a positive timeout"
            )

    def command(self) -> str:
        command = shutil.which(self.executable)
        if command is None:
            raise ValueError(f"Pi executable not found: {self.executable}")
        return command

    def probe(self) -> dict:
        try:
            result = subprocess.run(
                [self.command(), "--version"],
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
                env=runtime_environment(),
            )
        except subprocess.SubprocessError as error:
            raise RuntimeError("Pi version probe failed") from error
        version = result.stdout.strip()
        if not version:
            raise ValueError("Pi did not report its version")
        model = self.require_vision()
        return {"runtime": "pi", "version": version, "model": model}

    def require_vision(self) -> str:
        """Inspect Pi's selected model without making a model request."""
        with (
            tempfile.TemporaryDirectory(prefix="vitroflow-pi-probe-") as temporary,
            subprocess.Popen(
                [
                    self.command(),
                    "--mode",
                    "rpc",
                    "--no-session",
                    *(["--model", self.model] if self.model else []),
                    "--no-extensions",
                    "--no-skills",
                    "--no-context-files",
                ],
                cwd=temporary,
                env=runtime_environment(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            ) as process,
        ):
            assert process.stdin is not None and process.stdout is not None
            answers: queue.Queue[bytes] = queue.Queue()
            stdout = process.stdout

            def read() -> None:
                for line in stdout:
                    answers.put(line)

            reader = threading.Thread(target=read, daemon=True)
            reader.start()
            try:
                process.stdin.write(b'{"type":"get_state","id":"vision-probe"}\n')
                process.stdin.flush()
                deadline = time.monotonic() + 15
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ValueError("Pi model probe timed out")
                    try:
                        event = json.loads(answers.get(timeout=min(remaining, 0.2)))
                    except queue.Empty:
                        if process.poll() is not None:
                            raise ValueError(
                                "Pi could not load the selected model"
                            ) from None
                        continue
                    if event.get("id") != "vision-probe":
                        continue
                    model = event.get("data", {}).get("model")
                    if not event.get("success") or not isinstance(model, dict):
                        raise ValueError("Pi has no selected model")
                    if "image" not in model.get("input", []):
                        raise ValueError(
                            "Selected Pi model does not support image input"
                        )
                    provider, identifier = model.get("provider"), model.get("id")
                    if not isinstance(provider, str) or not isinstance(identifier, str):
                        raise TypeError("Pi did not report the selected model identity")
                    return f"{provider}/{identifier}"
            finally:
                terminate_process(process)
                reader.join(timeout=3)

    def execute(
        self,
        prompt: str,
        directory: Path,
        *,
        descriptor: dict,
        cancelled: Callable[[], bool] = lambda: False,
        tick: Callable[[], None] = lambda: None,
        extension: Path | None = None,
        active_tools: tuple[str, ...] = ("read",),
    ) -> dict:
        directory.mkdir(parents=True, exist_ok=False, mode=0o700)
        # Pi reads its own provider credentials. Supervisor credentials are not
        # inherited. This environment boundary is not a filesystem sandbox.
        environment = runtime_environment()
        args = [
            self.command(),
            "-p",
            "--mode",
            "json",
            "--session",
            str(directory / "session.jsonl"),
            "--model",
            descriptor["model"],
            "--no-extensions",
            "--no-skills",
            "--no-context-files",
            "--tools",
            ",".join(active_tools),
            *(["--extension", str(extension)] if extension else []),
        ]
        events: queue.Queue[dict | Exception | None] = queue.Queue(maxsize=64)
        with (directory / "stderr.log").open("wb") as stderr:
            process = subprocess.Popen(
                args,
                cwd=directory,
                env=environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=stderr,
                start_new_session=True,
            )
            assert process.stdout is not None and process.stdin is not None
            stdout = process.stdout

            def read_events() -> None:
                try:
                    with (directory / "events.jsonl").open("wb") as log:
                        for line in stdout:
                            log.write(line)
                            value = json.loads(line)
                            if not isinstance(value, dict):
                                raise TypeError("Pi event must be a JSON object")
                            events.put(value)
                except (OSError, ValueError, TypeError) as error:
                    events.put(error)
                finally:
                    events.put(None)

            reader = threading.Thread(target=read_events, daemon=True)
            reader.start()
            started = time.monotonic()
            messages = []
            terminal_error = None
            try:
                process.stdin.write(prompt.encode())
                process.stdin.close()
                ended = False
                while not ended or process.poll() is None:
                    if cancelled():
                        raise AgentInterruptedError("AI annotation cancelled")
                    if time.monotonic() - started > self.timeout_seconds:
                        raise RuntimeError("Pi exceeded the annotation time limit")
                    tick()
                    try:
                        event = events.get(timeout=0.2)
                    except queue.Empty:
                        continue
                    if event is None:
                        ended = True
                    elif isinstance(event, Exception):
                        raise RuntimeError("Invalid Pi JSON event stream") from event
                    elif event.get("type") == "message_end":
                        message = event.get("message", {})
                        if message.get("role") == "assistant":
                            messages.append(
                                {
                                    key: message.get(key)
                                    for key in (
                                        "provider",
                                        "model",
                                        "usage",
                                        "stopReason",
                                    )
                                }
                            )
                            if message.get("stopReason") in ("error", "aborted"):
                                terminal_error = "Pi ended with an assistant error; see local runtime logs"
                            else:
                                terminal_error = None
                    elif event.get("type") == "auto_retry_end" and not event.get(
                        "success"
                    ):
                        terminal_error = "Pi exhausted provider retries"
                if process.wait() != 0 or terminal_error:
                    raise RuntimeError(
                        terminal_error or "Pi process failed; see local runtime logs"
                    )
                if not messages:
                    raise RuntimeError("Pi returned no assistant completion")
                return {
                    **descriptor,
                    "messages": messages,
                    "elapsedSeconds": time.monotonic() - started,
                }
            finally:
                # Stop descendants as well as the Pi process, including tools
                # that remain alive after their parent has exited.
                terminate_process(process)
                # Drain the reader queue while it exits after cancellation.
                while reader.is_alive():
                    try:
                        events.get(timeout=0.1)
                    except queue.Empty:
                        pass
                stdout.close()


def terminate_process(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    # A tool can survive after Pi exits; its process group must also end.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def runtime_environment() -> dict[str, str]:
    names = {
        "HOME",
        "PATH",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "NODE_EXTRA_CA_CERTS",
        "PI_CODING_AGENT_DIR",
        "XDG_CONFIG_HOME",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "OPENROUTER_API_KEY",
        "MISTRAL_API_KEY",
        "GROQ_API_KEY",
        "XAI_API_KEY",
        "AWS_PROFILE",
        "AWS_REGION",
    }
    return {key: value for key, value in os.environ.items() if key in names}
