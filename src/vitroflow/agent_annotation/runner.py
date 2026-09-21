"""Freeze one image, run one agent session per region, export what was accepted."""

from __future__ import annotations

import sys
import time
from collections.abc import Callable, Iterator
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from pathlib import Path

from vitroflow.agent_annotation.coordinator import Coordinator
from vitroflow.agent_annotation.instructions import runtime_prompt
from vitroflow.agent_annotation.tools import DEFINITIONS
from vitroflow.agent_runtimes.contract import (
    AgentInterruptedError,
    AgentRuntime,
    ToolSet,
)
from vitroflow.autoannotation.preparation import prepare
from vitroflow.autoannotation.protocol import digest, object_digest
from vitroflow.autoannotation.results import collect_responses
from vitroflow.autoannotation.storage import read_json, write_json
from vitroflow.autoannotation.tasks import load_package

MAX_PARALLEL = 16
FAILURES = (OSError, ValueError, RuntimeError)


def run_annotation(
    image: Path,
    directory: Path,
    runtime: AgentRuntime,
    *,
    prelabels: Path | None = None,
    config: dict | None = None,
    crop: list[int] | None = None,
    max_parallel: int = 2,
    resume: bool = False,
    cancelled: Callable[[], bool] = lambda: False,
    progress: Callable[[int, int], None] = lambda _done, _total: None,
) -> dict:
    """One annotation round over one image.

    A fresh run freezes the image into a task package under `directory`; a
    resume reopens that package and finishes only its unaccepted regions.
    `status.json` records the outcome of a run that owns the directory; a
    request that is refused before ownership leaves it untouched.
    """
    if (
        isinstance(max_parallel, bool)
        or not isinstance(max_parallel, int)
        or not 1 <= max_parallel <= MAX_PARALLEL
    ):
        raise ValueError(f"parallel must be an integer in [1, {MAX_PARALLEL}]")
    started = time.monotonic()
    with _execution(image, directory, prelabels, config, crop, resume) as coordinator:
        descriptor = supervise(
            coordinator,
            runtime,
            max_parallel=max_parallel,
            cancelled=cancelled,
            progress=progress,
        )
        return export(coordinator, descriptor, started)


def recover_annotation(
    image: Path,
    directory: Path,
    *,
    prelabels: Path | None = None,
    config: dict | None = None,
    crop: list[int] | None = None,
    cancelled: Callable[[], bool] = lambda: False,
) -> dict:
    """Recover a fully accepted run's export without starting an agent session."""
    started = time.monotonic()
    with _execution(image, directory, prelabels, config, crop, True) as coordinator:
        if not all(event.is_set() for event in coordinator.events.values()):
            raise RuntimeError(
                "Unfinished local AI run; explicitly resume it or start a new run"
            )
        if cancelled():
            raise AgentInterruptedError("AI annotation cancelled")
        descriptor = read_json(coordinator.directory / "descriptor.json")
        return export(coordinator, descriptor, started)


@contextmanager
def _execution(
    image: Path,
    directory: Path,
    prelabels: Path | None,
    config: dict | None,
    crop: list[int] | None,
    resume: bool,
) -> Iterator[Coordinator]:
    """Own inputs and status for the lifetime of a run or export recovery."""
    directory = directory.resolve()
    if resume and not directory.is_dir():
        raise ValueError("Resume requires an existing annotation run")
    identity = {
        "image": digest(image.read_bytes()),
        "prelabels": digest(prelabels.read_bytes()) if prelabels else None,
        "config": config or {},
        "crop": crop,
    }
    if resume and read_json(directory / "request.json") != identity:
        raise ValueError("Resume requires the original image, input and settings")
    directory.mkdir(parents=True, exist_ok=resume, mode=0o700)
    package = directory / "tasks"
    if not resume:
        try:
            write_json(directory / "request.json", identity)
            prepare(image, package, prelabels_path=prelabels, config=config, crop=crop)
        except FAILURES as error:
            write_json(
                directory / "status.json", {"status": "failed", "error": str(error)}
            )
            raise
    with Coordinator(directory, package) as coordinator:
        write_json(directory / "status.json", {"status": "running"})
        try:
            yield coordinator
        except FAILURES as error:
            write_json(
                directory / "status.json", {"status": "failed", "error": str(error)}
            )
            raise
        else:
            write_json(directory / "status.json", {"status": "succeeded"})


def supervise(
    coordinator: Coordinator,
    runtime: AgentRuntime,
    *,
    max_parallel: int,
    cancelled: Callable[[], bool],
    progress: Callable[[int, int], None],
) -> dict:
    """Runs one session per unaccepted region, at most `max_parallel` at a time.

    A failed session stops further dispatch while the sessions already running
    finish, so their acceptances survive for a resume. Cancellation fences the
    coordinator at once and stops the running sessions, so nothing submitted
    after it is accepted. Returns the frozen runtime descriptor.
    """
    total = len(coordinator.tasks)
    pending = [key for key, event in coordinator.events.items() if not event.is_set()]
    descriptor = frozen_descriptor(coordinator, runtime, pending)
    producer = f"{descriptor['runtime']}/{descriptor['model']}"
    reported = -1

    def report() -> None:
        nonlocal reported
        count = sum(event.is_set() for event in coordinator.events.values())
        if count != reported:
            progress(count, total)
            reported = count

    report()
    failure: Exception | None = None
    active: dict = {}

    def dispatching() -> bool:
        return bool(pending) and failure is None and not coordinator.stopped()

    with ThreadPoolExecutor(max_workers=max_parallel) as pool:
        try:
            while active or dispatching():
                if cancelled():
                    coordinator.stop()
                while dispatching() and len(active) < max_parallel:
                    key = pending.pop(0)
                    attempt = coordinator.command(
                        "start", taskId=key, producer=producer
                    )
                    active[
                        pool.submit(
                            session, coordinator, runtime, descriptor, key, attempt
                        )
                    ] = key
                done, _ = wait(active, timeout=0.2, return_when=FIRST_COMPLETED)
                for future in done:
                    active.pop(future)
                    try:
                        future.result()
                    except FAILURES as error:
                        failure = failure or error
                report()
        finally:
            coordinator.stop()
    if cancelled():
        raise AgentInterruptedError("AI annotation cancelled")
    if failure:
        raise failure
    return descriptor


def frozen_descriptor(
    coordinator: Coordinator, runtime: AgentRuntime, pending: list[str]
) -> dict:
    """The runtime identity the run's first session bound it to.

    Every later session, including those of a resume, must come from the same
    runtime, model and version. A run with nothing left to do never probes.
    """
    file = coordinator.directory / "descriptor.json"
    if not pending:
        return read_json(file)
    descriptor = runtime.probe()
    if file.exists() and read_json(file) != descriptor:
        raise ValueError("Resume requires the original runtime, model and version")
    write_json(file, descriptor)
    return descriptor


def session(
    coordinator: Coordinator,
    runtime: AgentRuntime,
    descriptor: dict,
    key: str,
    attempt: dict,
) -> None:
    """One agent session over one region, recorded in the attempt's folder.

    The coordinator's acceptance is the outcome; how the process ended after
    that is only a record.
    """
    folder = Path(attempt["directory"])
    prompt = runtime_prompt(coordinator.package, coordinator.manifest, key)
    (folder / "prompt.txt").write_text(prompt, encoding="utf-8")
    tools = ToolSet(
        (
            sys.executable,
            "-m",
            "vitroflow.agent_annotation.tools",
            "--config",
            str(folder / "tools/config.json"),
        ),
        DEFINITIONS,
    )
    accepted = coordinator.events[key].is_set
    try:
        outcome = runtime.execute(
            prompt,
            folder / "runtime",
            descriptor=descriptor,
            tools=tools,
            cancelled=coordinator.stopped,
            completed=accepted,
        )
        if not accepted():
            raise RuntimeError(f"Task {key} did not submit a complete proposal")
    except FAILURES as error:
        if not accepted():
            coordinator.command(
                "fail", taskId=key, attemptId=attempt["attemptId"], error=str(error)
            )
            write_json(folder / "execution.json", {**descriptor, "error": str(error)})
            raise
        outcome = {
            **descriptor,
            "completedBySubmission": True,
            "errorAfterSubmission": str(error),
        }
    write_json(folder / "execution.json", outcome)


def export(coordinator: Coordinator, descriptor: dict, started: float) -> dict:
    """Source-coordinate results from the accepted responses.

    Export happens once per run. A later pass over the same acceptances, such
    as a Worker recovering delivery, reuses the export and must find it intact.
    """
    directory, package, manifest = (
        coordinator.directory,
        coordinator.package,
        coordinator.manifest,
    )
    if load_package(package) != manifest:
        raise ValueError("Frozen annotation input changed")
    state = coordinator.snapshot()
    accepted = {
        key: row["response"]
        for key, row in state["tasks"].items()
        if row["state"] == "accepted"
    }
    if len(accepted) != len(manifest["tasks"]):
        raise RuntimeError("Not all annotation tasks completed")
    attempts = {key: row["attemptId"] for key, row in state["tasks"].items()}
    execution_file = directory / "execution.json"
    if execution_file.exists():
        execution = read_json(execution_file)
        if {v["taskId"]: v["attemptId"] for v in execution["tasks"]} != attempts:
            raise ValueError(
                "Existing execution metadata does not match accepted attempts"
            )
    else:
        execution = {
            **descriptor,
            "elapsedSeconds": time.monotonic() - started,
            "completedBySubmission": True,
            "tasks": [
                {
                    "taskId": key,
                    "attemptId": attempt,
                    **attempt_outcome(directory, key, attempt),
                }
                for key, attempt in attempts.items()
            ],
        }
        write_json(execution_file, execution)
    destination = directory / "result"
    if destination.exists():
        document = read_json(destination / "result.json")
        expected = {
            key: object_digest({"response": value}) for key, value in accepted.items()
        }
        if (
            document["packageId"] != manifest["packageId"]
            or document["checkpointDigests"] != expected
        ):
            raise ValueError("Existing export does not match accepted results")
        result = {
            "count": len(document["instances"]),
            "warnings": len(document["warnings"]),
            "output": str(destination),
            "packageId": manifest["packageId"],
        }
    else:
        result = collect_responses(package, destination, accepted)
    return {"result": result, "execution": execution, "directory": str(directory)}


def attempt_outcome(directory: Path, key: str, attempt: str) -> dict:
    """What the session recorded, or the acceptance alone when it recorded nothing."""
    file = directory / "attempts" / key / attempt / "execution.json"
    return (
        read_json(file)
        if file.exists()
        else {"completedBySubmission": True, "recovered": True}
    )
