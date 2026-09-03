from __future__ import annotations

import logging
import os
import tempfile
import threading
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx

from .documents import as_object, expect_fields
from .image_io import CANONICAL_EXTENSION, verify_digest
from .training_contracts import (
    TrainingJob,
    TrainingPhase,
    TrainingSnapshot,
    parse_training_snapshot,
)
from .worker_connection import (
    WorkerConnection,
    WorkerHttpClient,
    validate_worker_process,
)
from .worker_runtime import shutdown_signals
from .yolo import (
    DatasetImage,
    EpochReport,
    YoloTrainingInterruptedError,
    export_dataset_images,
    train_yolo_detector,
)

LEASE_REFRESH_SECONDS = 30.0
LOGGER = logging.getLogger(__name__)


def device_memory_bytes(device: str) -> int:
    """The memory the accelerator offers a training process.

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


class TrainingArtifactRejectedError(RuntimeError):
    pass


class TrainingLeaseLostError(RuntimeError):
    pass


@dataclass(frozen=True)
class TrainingWorkerSettings:
    server_url: str
    token: str
    worker_id: str
    device: str
    work_dir: Path
    poll_seconds: float = 10.0

    def __post_init__(self) -> None:
        WorkerConnection(server_url=self.server_url, token=self.token)
        validate_worker_process(
            self.worker_id,
            self.poll_seconds,
            self.device,
            device_required=True,
        )


class TrainingWorkerClient(WorkerHttpClient):
    def __init__(
        self,
        server_url: str,
        token: str,
        worker_id: str,
        session_id: str,
        started_at: str,
        device: str,
        memory_bytes: int,
        *,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.worker_id = worker_id
        self.session_id = session_id
        self.started_at = started_at
        self.device = device
        self.memory_bytes = memory_bytes
        self.current_run_id: str | None = None
        super().__init__(
            WorkerConnection(server_url=server_url, token=token),
            timeout=timeout,
            transport=transport,
        )

    @property
    def identity(self) -> dict[str, str]:
        return {"workerId": self.worker_id, "sessionId": self.session_id}

    def heartbeat(self) -> None:
        response = self.request(
            "POST",
            "api/training/heartbeat",
            json={
                **self.identity,
                "startedAt": self.started_at,
                "device": self.device,
                "memoryBytes": self.memory_bytes,
                "currentTrainingRunId": self.current_run_id,
            },
        )
        response.raise_for_status()

    def claim(self) -> TrainingJob | None:
        response = self.request(
            "POST",
            "api/training/claim",
            json=self.identity,
        )
        response.raise_for_status()
        document = as_object(response.json(), "training claim response")
        expect_fields(document, {"run"}, "training claim response")
        if document["run"] is None:
            return None
        job = TrainingJob.parse(document["run"])
        if (job.worker_id, job.session_id) != (self.worker_id, self.session_id):
            raise ValueError("Training claim returned another worker's lease")
        return job

    @staticmethod
    def _require_active_lease(response: httpx.Response) -> None:
        if response.status_code == 409:
            raise TrainingLeaseLostError(response.text)
        response.raise_for_status()

    def fetch_snapshot(self, run_id: str) -> TrainingSnapshot:
        response = self.request(
            "GET",
            f"api/training/runs/{run_id}/snapshot",
            params=self.identity,
        )
        self._require_active_lease(response)
        return parse_training_snapshot(response.json())

    def enter_phase(self, run_id: str, phase: TrainingPhase) -> None:
        response = self.request(
            "POST",
            f"api/training/runs/{run_id}/phase",
            json={
                **self.identity,
                "phase": phase,
            },
        )
        self._require_active_lease(response)

    def renew_lease(self, run_id: str) -> None:
        response = self.request(
            "POST",
            f"api/training/runs/{run_id}/lease",
            json=self.identity,
        )
        self._require_active_lease(response)

    def report_epoch(self, run_id: str, report: EpochReport) -> None:
        response = self.request(
            "POST",
            f"api/training/runs/{run_id}/epochs",
            json={**self.identity, **report.to_json()},
        )
        self._require_active_lease(response)

    def download_image(self, run_id: str, digest: str) -> bytes:
        response = self.request(
            "GET",
            f"api/training/runs/{run_id}/images/{digest}",
            params=self.identity,
        )
        self._require_active_lease(response)
        return verify_digest(response.content, digest)

    def publish_artifact(self, run_id: str, weights: Path, inference: Path) -> None:
        response = self.request(
            "PUT",
            f"api/training/runs/{run_id}/artifact",
            data=self.identity,
            files={
                "weights": ("best.pt", weights.read_bytes()),
                "inference": (
                    "inference.json",
                    inference.read_bytes(),
                    "application/json",
                ),
            },
            timeout=None,
        )
        if response.status_code in {400, 422}:
            raise TrainingArtifactRejectedError(response.text)
        if response.status_code == 409:
            raise TrainingLeaseLostError(response.text)
        response.raise_for_status()

    def report_failure(self, run_id: str, error: str) -> None:
        response = self.request(
            "POST",
            f"api/training/runs/{run_id}/fail",
            json={**self.identity, "error": error[:2000]},
        )
        if response.status_code == 409:
            return
        response.raise_for_status()


def materialize_snapshot(
    client: TrainingWorkerClient,
    job: TrainingJob,
    output: Path,
    *,
    cancelled: Callable[[], bool] | None = None,
) -> Path:
    if cancelled and cancelled():
        raise YoloTrainingInterruptedError("training interrupted")
    snapshot = client.fetch_snapshot(job.run_id)
    if len(snapshot.images) < 2:
        raise ValueError("Training snapshot must contain at least two images")
    downloads = output.parent / "snapshot-images"
    downloads.mkdir(parents=True, exist_ok=True)
    dataset_images: list[DatasetImage] = []
    for image in snapshot.images:
        if cancelled and cancelled():
            raise YoloTrainingInterruptedError("training interrupted")
        downloaded = downloads / f"{image.digest}{CANONICAL_EXTENSION}"
        downloaded.write_bytes(client.download_image(job.run_id, image.digest))
        dataset_images.append(
            DatasetImage(
                digest=image.digest,
                width=image.annotation.width,
                height=image.annotation.height,
                instances=image.annotation.instances,
                split=image.split,
                revision=image.annotation.revision,
                file_path=downloaded,
            )
        )
    export_dataset_images(dataset_images, snapshot.classes, output.parent, output)
    return output / "dataset.yaml"


@contextmanager
def _lease(
    client: TrainingWorkerClient,
    run_id: str,
    *,
    cancelled: Callable[[], bool] | None = None,
):
    """Keep ownership alive without writing phase or business progress."""
    closed = threading.Event()
    lost = threading.Event()
    refresh_errors: list[Exception] = []

    def refresh() -> None:
        while not closed.wait(LEASE_REFRESH_SECONDS):
            try:
                client.renew_lease(run_id)
                client.heartbeat()
            except Exception as error:  # noqa: BLE001 - process boundary owns the lease
                refresh_errors.append(error)
                lost.set()
                return

    def should_stop() -> bool:
        return lost.is_set() or bool(cancelled and cancelled())

    client.renew_lease(run_id)
    thread = threading.Thread(target=refresh, name="training-lease", daemon=True)
    thread.start()
    try:
        yield should_stop
    finally:
        closed.set()
        thread.join()
        if refresh_errors:
            raise TrainingLeaseLostError("Training lease refresh failed") from (
                refresh_errors[0]
            )


def process_training_job(
    client: TrainingWorkerClient,
    job: TrainingJob,
    work_root: Path,
    stopped: threading.Event | None = None,
) -> None:
    def ensure_running() -> None:
        if stopped and stopped.is_set():
            raise YoloTrainingInterruptedError("training interrupted")

    client.current_run_id = job.run_id
    client.heartbeat()
    try:
        recipe = job.recipe
        with tempfile.TemporaryDirectory(
            prefix="vitroflow-training-", dir=work_root
        ) as temporary:
            root = Path(temporary)
            with _lease(
                client,
                job.run_id,
                cancelled=stopped.is_set if stopped else None,
            ) as cancelled:
                client.enter_phase(job.run_id, "preparing")
                dataset = materialize_snapshot(
                    client,
                    job,
                    root / "dataset",
                    cancelled=cancelled,
                )
                result = train_yolo_detector(
                    dataset,
                    root / "run",
                    parameters=recipe.parameters,
                    model=recipe.base_model_reference,
                    model_digest=recipe.base_model_digest,
                    runtime_version=recipe.runtime_version,
                    device=client.device,
                    cancelled=cancelled,
                    on_training_start=lambda: client.enter_phase(
                        job.run_id, "training"
                    ),
                    on_epoch=lambda epoch: client.report_epoch(job.run_id, epoch),
                    on_validation_start=lambda: client.enter_phase(
                        job.run_id, "validating"
                    ),
                )
            ensure_running()
            if result.confidence is None:
                raise RuntimeError(
                    "Training completed without a usable validation signal"
                )
            client.publish_artifact(job.run_id, result.best_weights, result.summary)
    except (YoloTrainingInterruptedError, TrainingLeaseLostError):
        raise
    except Exception as error:
        try:
            client.report_failure(job.run_id, str(error) or type(error).__name__)
        except Exception:
            LOGGER.exception("failed to report training run failure")
        raise
    finally:
        client.current_run_id = None
        try:
            client.heartbeat()
        except Exception:
            LOGGER.exception("failed to clear training worker heartbeat")


def run_training_worker(
    settings: TrainingWorkerSettings,
    *,
    on_ready: Callable[[], None] | None = None,
) -> int:
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    client = TrainingWorkerClient(
        settings.server_url,
        settings.token,
        settings.worker_id,
        f"session-{uuid4()}",
        datetime.now(UTC).isoformat(),
        settings.device,
        device_memory_bytes(settings.device),
    )
    try:
        with shutdown_signals() as stopped:
            client.heartbeat()
            if on_ready:
                on_ready()
            while not stopped.is_set():
                job: TrainingJob | None = None
                try:
                    client.heartbeat()
                    job = client.claim()
                    if job:
                        process_training_job(
                            client, job, settings.work_dir, stopped=stopped
                        )
                except YoloTrainingInterruptedError:
                    LOGGER.info("training interrupted; lease will be recoverable")
                except Exception:
                    LOGGER.exception("training worker error")
                    job = None
                if not job:
                    stopped.wait(settings.poll_seconds)
            return 0
    finally:
        client.close()
