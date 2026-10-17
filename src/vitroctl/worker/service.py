"""One Worker process: it heartbeats, then serves whatever the workbench holds.

Training takes priority over inference. The process executes one assignment at
a time, holding a few more inference tasks whose images download meanwhile; it
releases those before it trains.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

import httpx

from vitroctl.detectors.ultralytics import YoloTrainingInterruptedError
from vitroctl.detectors.ultralytics.runtime import release_accelerator
from vitroctl.worker.images import ImageCache
from vitroctl.worker.inference import WORKER_ERRORS, InferenceClient, InferencePipeline
from vitroctl.worker.model_store import ModelStore
from vitroctl.worker.runtime import shutdown_signals
from vitroctl.worker.session import WorkerClient, WorkerSession, WorkerSettings
from vitroctl.worker.training import TrainingClient, process_training_job

LOGGER = logging.getLogger(__name__)


class Worker:
    """One session serves training and inference over one connection."""

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
            WorkerSession.create(settings.device),
            transport=transport,
        )
        self.inference = InferenceClient(self.client)
        self.training = TrainingClient(self.client)
        self.store = ModelStore(self.inference, settings.work_dir, settings.device)
        self.images = ImageCache(settings.work_dir / "images")
        self.pipeline = InferencePipeline(self.inference, self.store, self.images)

    def close(self) -> None:
        try:
            self.pipeline.close()
        finally:
            self.store.unload()
            self.images.close()
            self.client.close()

    def serve_once(self, stopped: threading.Event) -> bool:
        """Take at most one task; whether one was taken paces the outer loop."""
        self.client.heartbeat()
        if stopped.is_set():
            return False
        if self.client.session.can_train:
            job = self.training.claim()
            if job is not None:
                self.pipeline.release()
                self.store.unload()
                try:
                    process_training_job(
                        self.training,
                        job,
                        self.settings.work_dir,
                        self.settings.device,
                        self.images,
                        stopped=stopped,
                    )
                finally:
                    release_accelerator()
                return True
        return self.pipeline.run_once(stopped)


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
