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
from typing import Any, Literal, cast
from uuid import uuid4

import httpx

from .annotations import ReviewedImage, parse_annotation
from .documents import (
    as_digest,
    as_integer,
    as_list,
    as_number,
    as_object,
    as_string,
    expect_fields,
    expect_schema_version,
)
from .identifiers import CLASS_NAME, VERSION_ID, WORKER_ID
from .image_io import CANONICAL_EXTENSION, verify_digest
from .manifest import as_split
from .training_recipe import TrainingRecipe, parse_training_recipe
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

SNAPSHOT_SCHEMA_VERSION = 1
LEASE_REFRESH_SECONDS = 30.0
LOGGER = logging.getLogger(__name__)
TrainingPhase = Literal["preparing", "training", "validating"]


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


@dataclass(frozen=True, slots=True, kw_only=True)
class TrainingJob:
    run_id: str
    model_id: str
    dataset_snapshot_id: str
    created_at: datetime
    attempt: int
    recipe: TrainingRecipe
    worker_id: str
    session_id: str
    lease_expires_at: datetime
    phase: TrainingPhase
    progress: float

    @classmethod
    def parse(cls, value: Any, context: str = "training run") -> TrainingJob:
        run = as_object(value, context)
        expect_fields(
            run,
            {
                "schemaVersion",
                "id",
                "modelId",
                "datasetSnapshotId",
                "createdAt",
                "attempt",
                "recipe",
                "state",
            },
            context,
        )
        expect_schema_version(run, "schemaVersion", 1, context)
        run_id = _resource_id(run["id"], f"{context}.id")
        model_id = _resource_id(run["modelId"], f"{context}.modelId")
        snapshot_id = _resource_id(
            run["datasetSnapshotId"], f"{context}.datasetSnapshotId"
        )
        state_context = f"{context}.state"
        state = as_object(run["state"], state_context)
        expect_fields(
            state,
            {
                "status",
                "workerId",
                "sessionId",
                "leaseExpiresAt",
                "phase",
                "progress",
            },
            state_context,
        )
        if state["status"] != "running":
            raise ValueError(f"{state_context}.status must be running")
        phase = as_string(state["phase"], f"{state_context}.phase")
        if phase not in {"preparing", "training", "validating"}:
            raise ValueError(f"{state_context}.phase is invalid")
        progress = as_number(state["progress"], f"{state_context}.progress")
        if not 0 <= progress <= 1:
            raise ValueError(f"{state_context}.progress must be between 0 and 1")
        return cls(
            run_id=run_id,
            model_id=model_id,
            dataset_snapshot_id=snapshot_id,
            created_at=_timestamp(run["createdAt"], f"{context}.createdAt"),
            attempt=as_integer(run["attempt"], f"{context}.attempt", minimum=1),
            recipe=parse_training_recipe(run["recipe"], f"{context}.recipe"),
            worker_id=_worker_id(state["workerId"], f"{state_context}.workerId"),
            session_id=_resource_id(state["sessionId"], f"{state_context}.sessionId"),
            lease_expires_at=_timestamp(
                state["leaseExpiresAt"], f"{state_context}.leaseExpiresAt"
            ),
            phase=cast(TrainingPhase, phase),
            progress=progress,
        )


def _resource_id(value: Any, context: str) -> str:
    identifier = as_string(value, context)
    if not VERSION_ID.fullmatch(identifier):
        raise ValueError(f"{context} is invalid")
    return identifier


def _worker_id(value: Any, context: str) -> str:
    identifier = as_string(value, context)
    if not WORKER_ID.fullmatch(identifier):
        raise ValueError(f"{context} is invalid")
    return identifier


def _timestamp(value: Any, context: str) -> datetime:
    text = as_string(value, context)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise ValueError(f"{context} must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{context} must include a timezone")
    return parsed.astimezone(UTC)


@dataclass(frozen=True)
class SnapshotImage:
    digest: str
    width: int
    height: int
    split: str
    annotation: ReviewedImage


@dataclass(frozen=True)
class TrainingSnapshot:
    id: str
    dataset_id: str
    model_id: str
    classes: tuple[str, ...]
    images: tuple[SnapshotImage, ...]


def _snapshot_image(value: Any, context: str) -> SnapshotImage:
    entry = as_object(value, context)
    expect_fields(entry, {"digest", "width", "height", "split", "annotation"}, context)
    digest = as_digest(entry["digest"], f"{context}.digest")
    annotation = parse_annotation(entry["annotation"], f"{context}.annotation")
    if annotation.digest != digest:
        raise ValueError(f"{context}.annotation describes another image")
    if annotation.status != "complete":
        raise ValueError(f"{context}.annotation is not complete")
    width = as_integer(entry["width"], f"{context}.width", minimum=1)
    height = as_integer(entry["height"], f"{context}.height", minimum=1)
    if (annotation.width, annotation.height) != (width, height):
        raise ValueError(
            f"{context}.annotation is drawn on {annotation.width}x{annotation.height}, "
            f"not {width}x{height}"
        )
    return SnapshotImage(
        digest=digest,
        width=width,
        height=height,
        split=as_split(entry["split"], f"{context}.split"),
        annotation=annotation,
    )


def parse_training_snapshot(value: Any, context: str = "snapshot") -> TrainingSnapshot:
    document = as_object(value, context)
    expect_fields(
        document,
        {
            "schemaVersion",
            "id",
            "datasetId",
            "modelId",
            "classes",
            "createdAt",
            "images",
        },
        context,
    )
    expect_schema_version(document, "schemaVersion", SNAPSHOT_SCHEMA_VERSION, context)
    images = tuple(
        _snapshot_image(raw, f"{context}.images[{index}]")
        for index, raw in enumerate(as_list(document["images"], f"{context}.images"))
    )
    digests = [image.digest for image in images]
    if len(set(digests)) != len(digests):
        raise ValueError(f"{context} lists an image digest more than once")
    classes = tuple(
        as_string(item, f"{context}.classes[{index}]")
        for index, item in enumerate(as_list(document["classes"], f"{context}.classes"))
    )
    if not classes or len(set(classes)) != len(classes):
        raise ValueError(f"{context}.classes must be non-empty and unique")
    for name in classes:
        if not CLASS_NAME.fullmatch(name):
            raise ValueError(f"{context}.classes contains invalid class {name}")
    known = set(classes)
    for image in images:
        for instance in image.annotation.instances:
            if instance.class_name not in known:
                raise ValueError(
                    f"{context} annotation uses unknown class {instance.class_name}"
                )
    return TrainingSnapshot(
        id=as_string(document["id"], f"{context}.id"),
        dataset_id=as_string(document["datasetId"], f"{context}.datasetId"),
        model_id=as_string(document["modelId"], f"{context}.modelId"),
        classes=classes,
        images=images,
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
