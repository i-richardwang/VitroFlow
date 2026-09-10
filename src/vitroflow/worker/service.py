"""One Worker process: it heartbeats, then serves whatever the workbench holds.

A training run comes first when the process can train, because a run is hours
of work that should start as soon as a capable machine is free; inference pairs
fill the time between runs.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

import httpx

from vitroflow.detectors.ultralytics import YoloTrainingInterruptedError
from vitroflow.detectors.ultralytics.runtime import release_accelerator
from vitroflow.worker.inference import WORKER_ERRORS, InferenceClient, run_pass
from vitroflow.worker.model_store import ModelStore
from vitroflow.worker.runtime import shutdown_signals
from vitroflow.worker.session import WorkerClient, WorkerSession, WorkerSettings
from vitroflow.worker.training import TrainingClient, process_training_job

LOGGER = logging.getLogger(__name__)


class Worker:
    """A session's view of both queues over one connection."""

    def __init__(
        self,
        settings: WorkerSettings,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.client = WorkerClient(
            settings.server_url,
            settings.token,
            WorkerSession.create(settings.worker_id, settings.device),
            transport=transport,
        )
        self.inference = InferenceClient(self.client)
        self.training = TrainingClient(self.client)
        self.store = ModelStore(self.inference, settings.work_dir, settings.device)

    def close(self) -> None:
        self.store.unload()
        self.client.close()

    def serve_once(self, stopped: threading.Event) -> bool:
        """Take at most one task; whether one was taken paces the outer loop."""
        self.client.heartbeat()
        if stopped.is_set():
            return False
        if self.client.session.can_train:
            job = self.training.claim()
            if job is not None:
                self.store.unload()
                try:
                    process_training_job(
                        self.training,
                        job,
                        self.settings.work_dir,
                        self.settings.device,
                        stopped=stopped,
                    )
                finally:
                    release_accelerator()
                return True
        return run_pass(
            self.inference, self.settings.work_dir, self.store, stopped=stopped
        )


def run_worker(
    settings: WorkerSettings,
    *,
    on_ready: Callable[[], None] | None = None,
) -> int:
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    worker = Worker(settings)
    try:
        with shutdown_signals() as stopped:
            worker.client.heartbeat()
            if on_ready:
                on_ready()
            while not stopped.is_set():
                try:
                    worked = worker.serve_once(stopped)
                except YoloTrainingInterruptedError:
                    LOGGER.info("training interrupted; the lease will be reclaimed")
                    worked = False
                except WORKER_ERRORS as error:
                    LOGGER.error("worker error: %s", error)
                    worked = False
                if not worked:
                    stopped.wait(settings.poll_seconds)
            return 0
    finally:
        worker.close()
