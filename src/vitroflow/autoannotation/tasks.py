"""Portable package integrity, task checkpoints and execution operations."""

from __future__ import annotations

import fcntl
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from vitroflow.autoannotation import rendering
from vitroflow.autoannotation.protocol import (
    SCHEMA_VERSION,
    digest,
    fields,
    nonempty,
    object_digest,
    validate_edges,
    validate_response,
)
from vitroflow.autoannotation.storage import read_json, write_json
from vitroflow.io.files import atomic_file


def load_package(root: Path) -> dict:
    manifest = read_json(root / "manifest.json")
    fields(
        manifest,
        {
            "schemaVersion",
            "packageId",
            "source",
            "coverage",
            "config",
            "tasks",
            "assets",
        },
    )
    if manifest["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError("Unsupported annotation package schema")
    if (
        object_digest({k: v for k, v in manifest.items() if k != "packageId"})
        != manifest["packageId"]
    ):
        raise ValueError("Manifest integrity mismatch; prepare a new package")
    for relative, checksum in manifest["assets"].items():
        path = root / relative
        if Path(relative).is_absolute() or not path.resolve().is_relative_to(
            root.resolve()
        ):
            raise ValueError("Asset path escapes package")
        if digest(path.read_bytes()) != checksum:
            raise ValueError(f"Frozen asset changed: {relative}")
    return manifest


@contextmanager
def locked(root: Path) -> Iterator[None]:
    # An OS lock releases on process exit; the file itself does not hold state.
    with (root / ".lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Package is busy; retry this short operation") from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def outside_package(root: Path, destination: Path) -> None:
    if destination.resolve().is_relative_to(root.resolve()):
        raise ValueError("Output must be outside the task package")


def task_by_id(manifest: dict, identifier: str) -> dict:
    for task in manifest["tasks"]:
        if task["id"] == identifier:
            return task
    raise ValueError(f"Unknown task: {identifier}")


def checkpoint(root: Path, manifest: dict, task: dict) -> dict:
    path = root / "checkpoints" / f"{task['id']}.json"
    if not path.exists():
        return {}
    state = read_json(path)
    fields(state, set(), {"response", "error"})
    if "response" in state:
        validate_response(state["response"], manifest, task)
        validate_edges(state["response"], manifest, task)
    if "error" in state:
        nonempty(state["error"], "error")
        if "response" in state:
            raise ValueError("A completed task cannot also have an execution error")
    return state


def receipt(task: dict, state: dict) -> dict:
    value = {"taskId": task["id"], "state": "pending"}
    if "error" in state:
        value.update(state="failed", error=state["error"])
    if "response" in state:
        response = state["response"]
        value.update(
            state="complete",
            responseDigest=object_digest(response),
            unresolvedIssues=len(response["issues"]),
            uncertainInstances=sum(
                v.get("uncertain", False) for v in response["instances"]
            ),
        )
    return value


def status(root: Path) -> dict:
    with locked(root):
        manifest = load_package(root)
        rows = []
        for task in manifest["tasks"]:
            try:
                row = receipt(task, checkpoint(root, manifest, task))
            except (OSError, ValueError, TypeError, KeyError) as error:
                row = {"taskId": task["id"], "state": "invalid", "error": str(error)}
            rows.append(row)
    return {
        "packageId": manifest["packageId"],
        "complete": all(r["state"] == "complete" for r in rows),
        "tasks": rows,
    }


def preview(root: Path, identifier: str, value: dict, destination: Path) -> dict:
    outside_package(root, destination)
    with locked(root):
        manifest = load_package(root)
        task = task_by_id(manifest, identifier)
        validate_response(value, manifest, task)
        validate_edges(value, manifest, task)
        return rendering.preview(root, task, value, destination)


def submit(root: Path, identifier: str, value: dict) -> dict:
    with locked(root):
        manifest = load_package(root)
        task = task_by_id(manifest, identifier)
        state = checkpoint(root, manifest, task)
        validate_response(value, manifest, task)
        validate_edges(value, manifest, task)
        if "response" in state and state["response"] != value:
            raise ValueError(
                "Response already accepted; prepare a new round or reset before replacing it"
            )
        state = {"response": value}
        write_json(root / "checkpoints" / f"{identifier}.json", state)
        return receipt(task, state)


def fail(root: Path, identifier: str, message: str) -> dict:
    nonempty(message, "message")
    with locked(root):
        manifest = load_package(root)
        task = task_by_id(manifest, identifier)
        state = checkpoint(root, manifest, task)
        if "response" in state:
            raise ValueError("Completed task cannot fail; reset it first")
        state = {"error": message}
        write_json(root / "checkpoints" / f"{identifier}.json", state)
        return receipt(task, state)


def reset(root: Path, identifier: str) -> dict:
    with locked(root):
        manifest = load_package(root)
        task = task_by_id(manifest, identifier)
        path = root / "checkpoints" / f"{identifier}.json"
        if path.exists():
            # Preserve bytes even when an interrupted external edit made invalid JSON.
            previous = path.read_bytes()
            with atomic_file(
                root / "history" / f"{identifier}-{digest(previous)}.json"
            ) as handle:
                handle.write(previous)
            write_json(path, {})
        return receipt(task, {})
