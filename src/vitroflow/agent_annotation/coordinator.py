"""One local owner accepts tile proposals; image/preview work never enters it."""

from __future__ import annotations

import fcntl
import json
import os
import re
import secrets
import socket
import socketserver
import tempfile
import threading
from pathlib import Path
from typing import Self

from vitroflow.autoannotation.protocol import (
    object_digest,
    validate_edges,
    validate_response,
)
from vitroflow.autoannotation.storage import read_json, write_json
from vitroflow.autoannotation.tasks import load_package

# AF_UNIX paths are limited to 104 bytes on macOS; run directories can be deeper.
SOCKET_ROOT = Path("/tmp")
SUPERVISOR_EXITED = "Supervisor exited before acceptance"


class AnnotationRunBusyError(RuntimeError):
    """Another supervisor owns this run directory."""


def request(endpoint: str, value: dict) -> dict:
    """Small control messages only; large immutable artifacts stay on disk."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(30)
        connection.connect(endpoint)
        connection.sendall(json.dumps(value).encode() + b"\n")
        with connection.makefile("rb") as stream:
            answer = json.loads(stream.readline(65536))
    if "error" in answer:
        raise ValueError(answer["error"])
    return answer


class Coordinator:
    """The one owner of a run's attempts and accepted responses.

    Every task is `running`, `accepted` or `failed`. `state.json` is the durable
    authority, accepted responses included; the per-task events are in-memory
    wakeups rebuilt from it when a run is reopened. A file lock on the run
    directory selects the single owner; annotation tools only talk to it over a
    private socket whose server serializes lifecycle changes and acceptance.
    """

    def __init__(self, directory: Path, package: Path):
        self.directory = directory
        self.package = package
        self.owner = secrets.token_hex(32)
        self.events: dict[str, threading.Event] = {}
        self.stopping = threading.Event()

    def __enter__(self) -> Self:
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = (self.directory / ".owner").open("a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.lock.close()
            raise AnnotationRunBusyError(
                "This annotation run already has an active coordinator"
            ) from error
        try:
            self.manifest = load_package(self.package)
            self.tasks = {t["id"]: t for t in self.manifest["tasks"]}
            self.events = {key: threading.Event() for key in self.tasks}
            state_file = self.directory / "state.json"
            self.state = (
                read_json(state_file)
                if state_file.exists()
                else {
                    "schemaVersion": "vitroflow.annotation-run/v1",
                    "packageId": self.manifest["packageId"],
                    "tasks": {},
                }
            )
            if self.state.get("schemaVersion") != "vitroflow.annotation-run/v1":
                raise ValueError("Unsupported annotation execution state")
            if self.state["packageId"] != self.manifest["packageId"]:
                raise ValueError("Coordinator input identity changed")
            if not self.state["tasks"].keys() <= self.tasks.keys():
                raise ValueError("Coordinator contains unknown tasks")
            for key, row in self.state["tasks"].items():
                if row["state"] == "accepted":
                    self.validate(key, row["proposalId"], row["response"])
                    self.events[key].set()
                elif row["state"] == "running":
                    row.update(state="failed", error=SUPERVISOR_EXITED)
            self.persist()
            self.temporary = tempfile.TemporaryDirectory(
                prefix="vf-annotation-", dir=SOCKET_ROOT
            )
            self.endpoint = str(Path(self.temporary.name) / "control.sock")
            coordinator = self

            class Handler(socketserver.StreamRequestHandler):
                def handle(self):
                    self.connection.settimeout(5)
                    try:
                        raw = self.rfile.readline(65536)
                        if not raw.endswith(b"\n"):
                            raise ValueError("Invalid coordinator message")
                        value = coordinator.dispatch(json.loads(raw))
                    except (OSError, ValueError, KeyError, TypeError) as error:
                        value = {"error": str(error)}
                    try:
                        self.wfile.write(json.dumps(value).encode() + b"\n")
                    except (BrokenPipeError, ConnectionResetError):
                        pass  # Acceptance is durable even when its reply is lost.

            class ControlServer(socketserver.UnixStreamServer):
                # Accommodate the bounded session fanout and replayed receipts.
                request_queue_size = 64

            self.server = ControlServer(self.endpoint, Handler)
            self.thread = threading.Thread(
                target=self.server.serve_forever,
                kwargs={"poll_interval": 0.05},
                daemon=True,
            )
            self.thread.start()
            return self
        except BaseException:
            if hasattr(self, "server"):
                self.server.server_close()
            if hasattr(self, "temporary"):
                self.temporary.cleanup()
            self.lock.close()
            raise

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()
        self.lock.close()

    def persist(self) -> None:
        try:
            write_json(self.directory / "state.json", self.state)
            descriptor = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        except OSError:
            if (self.directory / "state.json").exists():
                self.state = read_json(self.directory / "state.json")
            raise

    def snapshot(self) -> dict:
        # Reading an atomically published document never locks inputs or writers.
        return read_json(self.directory / "state.json")

    def validate(self, key: str, proposal_id: str, response: dict) -> None:
        if (
            not re.fullmatch(r"[a-f0-9]{64}", proposal_id)
            or object_digest(response) != proposal_id
        ):
            raise ValueError("Preview digest mismatch")
        if response["producer"] != self.state["tasks"][key]["producer"]:
            raise ValueError("Proposal producer identity mismatch")
        validate_response(response, self.manifest, self.tasks[key])
        validate_edges(response, self.manifest, self.tasks[key])

    def command(self, operation: str, **values) -> dict:
        return request(
            self.endpoint, {"operation": operation, "owner": self.owner, **values}
        )

    def stopped(self) -> bool:
        return self.stopping.is_set()

    def stop(self) -> None:
        """Refuses every further start and acceptance; running sessions are told to end."""
        if self.stopping.is_set():
            return
        self.stopping.set()
        self.command("stop")

    def dispatch(self, message: dict) -> dict:
        operation = message["operation"]
        if operation != "submit" and message.get("owner") != self.owner:
            raise ValueError("Invalid coordinator owner")
        if operation == "stop":
            for row in self.state["tasks"].values():
                if row["state"] == "running":
                    row.update(state="failed", error=SUPERVISOR_EXITED)
            self.persist()
            return {"stopped": True}
        key = message["taskId"]
        if key not in self.tasks:
            raise ValueError("Unknown task")
        row = self.state["tasks"].get(key)
        if operation == "start":
            if self.stopping.is_set():
                raise ValueError("Coordinator stopped")
            if row and row["state"] in ("running", "accepted"):
                raise ValueError("Task already running or accepted")
            attempt = secrets.token_hex(16)
            folder = self.directory / "attempts" / key / attempt
            folder.mkdir(parents=True)
            settings = {
                "package": str(self.package),
                "packageId": self.manifest["packageId"],
                "taskId": key,
                "attemptId": attempt,
                "endpoint": self.endpoint,
                "producer": message["producer"],
            }
            write_json(folder / "tools" / "config.json", settings)
            self.state["tasks"][key] = {
                "state": "running",
                "attemptId": attempt,
                "producer": message["producer"],
            }
            self.persist()
            return {"directory": str(folder), **settings}
        if not row or message.get("attemptId") != row["attemptId"]:
            raise ValueError("Stale annotation attempt")
        if operation == "fail":
            if row["state"] != "accepted":
                row.update(state="failed", error=message["error"])
                self.persist()
            return {"state": row["state"]}
        if operation != "submit":
            raise ValueError("Unknown coordinator operation")
        proposal_id = message["proposalId"]
        if row["state"] == "accepted":
            if row["proposalId"] != proposal_id:
                raise ValueError("Task already accepted a different proposal")
            if not self.events[key].is_set():
                # A previous write may have been renamed before its directory
                # sync failed. Finish durability before acknowledging its replay.
                self.persist()
                self.events[key].set()
            return {"taskId": key, "state": "complete", "proposalId": proposal_id}
        if self.stopping.is_set() or row["state"] != "running":
            raise ValueError("Annotation attempt is no longer active")
        if not isinstance(proposal_id, str) or not re.fullmatch(
            r"[a-f0-9]{64}", proposal_id
        ):
            raise ValueError("Invalid proposal identity")
        path = (
            self.directory
            / "attempts"
            / key
            / row["attemptId"]
            / "tools"
            / "responses"
            / "proposals"
            / f"{proposal_id}.json"
        )
        response = read_json(path)
        self.validate(key, proposal_id, response)
        row.update(state="accepted", proposalId=proposal_id, response=response)
        self.persist()
        self.events[key].set()
        return {"taskId": key, "state": "complete", "proposalId": proposal_id}
