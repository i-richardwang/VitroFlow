"""What every Worker process is to the workbench: one session of one worker.

A session heartbeats who it is and what it can do; the work it holds is a
lease the workbench fences by the same identity. Inference and training keep
their own protocols for the work itself.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx

from .config import PipelineConfig
from .detectors import (
    RuntimeDescriptor,
    TraditionalDetector,
    ultralytics_runtime_descriptor,
)
from .scoring import DEFAULT_MODEL
from .worker_connection import (
    WorkerConnection,
    WorkerHttpClient,
    validate_worker_process,
)
from .yolo.runtime import ultralytics_installed

LEASE_REFRESH_SECONDS = 30.0
LOGGER = logging.getLogger(__name__)


class LeaseLostError(RuntimeError):
    """The workbench no longer holds this session as the owner of its work."""


@dataclass(frozen=True)
class WorkerSettings:
    server_url: str
    token: str
    worker_id: str
    work_dir: Path
    poll_seconds: float = 5.0
    device: str | None = None

    def __post_init__(self) -> None:
        WorkerConnection(server_url=self.server_url, token=self.token)
        validate_worker_process(self.worker_id, self.poll_seconds, self.device)


def available_runtimes() -> tuple[RuntimeDescriptor, ...]:
    """The adapters this process executes; training needs the ultralytics one."""
    runtimes = [TraditionalDetector(PipelineConfig(), DEFAULT_MODEL).runtime]
    if ultralytics_installed():
        runtimes.append(ultralytics_runtime_descriptor())
    return tuple(runtimes)


def device_memory_bytes(device: str) -> int:
    """The memory the accelerator offers a job.

    Unified-memory Macs report Metal's recommended working set, CUDA devices
    their total memory, and the CPU the machine's physical memory.
    """
    if device == "cpu":
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    import torch

    if device == "mps":
        return int(torch.mps.recommended_max_memory())
    index = int(device.partition(":")[2] or "0")
    return int(torch.cuda.mem_get_info(index)[1])


@dataclass(frozen=True)
class WorkerSession:
    """One process incarnation of a worker and what it can do."""

    worker_id: str
    session_id: str
    started_at: str
    runtimes: tuple[RuntimeDescriptor, ...]
    memory_bytes: int

    @classmethod
    def create(cls, worker_id: str, device: str | None) -> WorkerSession:
        return cls(
            worker_id,
            f"session-{uuid4()}",
            datetime.now(UTC).isoformat(),
            available_runtimes(),
            device_memory_bytes(device or "cpu"),
        )

    @property
    def identity(self) -> dict[str, str]:
        return {"workerId": self.worker_id, "sessionId": self.session_id}

    @property
    def can_train(self) -> bool:
        """Training runs on the ultralytics runtime; without it a worker only detects."""
        return any(runtime.adapter == "ultralytics" for runtime in self.runtimes)

    def heartbeat(self) -> dict[str, object]:
        return {
            **self.identity,
            "startedAt": self.started_at,
            "runtimes": [runtime.to_dict() for runtime in self.runtimes],
            "memoryBytes": self.memory_bytes,
        }


class WorkerClient(WorkerHttpClient):
    """The workbench as one worker session sees it."""

    def __init__(
        self,
        server_url: str,
        token: str,
        session: WorkerSession,
        *,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.session = session
        super().__init__(
            WorkerConnection(server_url=server_url, token=token),
            timeout=timeout,
            transport=transport,
        )

    @property
    def identity(self) -> dict[str, str]:
        return self.session.identity

    def heartbeat(self) -> None:
        response = self.request(
            "POST", "api/worker/heartbeat", json=self.session.heartbeat()
        )
        self.require_current_session(response)

    @staticmethod
    def require_current_session(response: httpx.Response) -> None:
        """A 409 means another session owns this identity or its work."""
        if response.status_code == 409:
            raise LeaseLostError(response.text)
        response.raise_for_status()


@contextmanager
def keep_lease(
    client: WorkerClient,
    renew: Callable[[], None],
    *,
    cancelled: Callable[[], bool] | None = None,
) -> Iterator[Callable[[], bool]]:
    """
    Keep one lease live while the work runs. The refresher renews the lease
    and heartbeats on a schedule; the caller polls the yielded predicate and
    stops when the lease is lost or the process is shutting down.
    """
    closed = threading.Event()
    lost = threading.Event()
    refresh_errors: list[Exception] = []

    def refresh() -> None:
        while not closed.wait(LEASE_REFRESH_SECONDS):
            try:
                renew()
                client.heartbeat()
            except Exception as error:  # noqa: BLE001 - process boundary owns the lease
                refresh_errors.append(error)
                lost.set()
                return

    def should_stop() -> bool:
        return lost.is_set() or bool(cancelled and cancelled())

    renew()
    thread = threading.Thread(target=refresh, name="worker-lease", daemon=True)
    thread.start()
    try:
        yield should_stop
    finally:
        closed.set()
        thread.join()
        if refresh_errors:
            raise LeaseLostError("Lease refresh failed") from refresh_errors[0]
