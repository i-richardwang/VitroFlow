"""Process-group cleanup and the external runtime environment boundary."""

import json
import os
import queue
import signal
import subprocess
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def json_event_stream(
    process: subprocess.Popen[bytes], path: Path
) -> Iterator[queue.Queue[dict | Exception | None]]:
    """Persist JSON events and own reader/process cleanup across all exit paths."""
    assert process.stdout is not None
    stdout = process.stdout
    events: queue.Queue[dict | Exception | None] = queue.Queue(maxsize=64)

    def read() -> None:
        try:
            with path.open("wb") as log:
                for line in stdout:
                    log.write(line)
                    log.flush()
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise TypeError("Runtime event must be a JSON object")
                    events.put(value)
        except (OSError, ValueError, TypeError) as error:
            events.put(error)
        finally:
            events.put(None)

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    try:
        yield events
    finally:
        terminate_process(process)
        # A bounded queue needs a consumer until its producer has exited.
        while reader.is_alive():
            try:
                events.get(timeout=0.1)
            except queue.Empty:
                pass
        stdout.close()
        if process.stdin is not None:
            process.stdin.close()


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
    # A tool can survive after its parent exits; its process group must also end.
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


def query_process(command: list[str], *, directory: str, timeout: float) -> str:
    """Read a CLI query and always reap its process group, including on timeout."""
    process = subprocess.Popen(
        command,
        cwd=directory,
        env=runtime_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
        text=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        if process.returncode:
            raise subprocess.CalledProcessError(
                process.returncode, command, stdout, stderr
            )
        return stdout
    finally:
        terminate_process(process)
