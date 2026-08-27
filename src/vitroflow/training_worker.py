from __future__ import annotations

import logging
import tempfile
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from .annotations import ReviewedImage, parse_annotation
from .documents import (
    as_digest,
    as_extension,
    as_list,
    as_object,
    as_string,
    expect_fields,
    expect_schema_version,
)
from .identifiers import WORKER_DEVICE, WORKER_ID
from .image_io import verify_digest
from .manifest import as_split
from .worker_runtime import shutdown_signals
from .yolo import (
    DatasetImage,
    YoloTrainingInterruptedError,
    export_dataset_images,
    train_yolo_detector,
)

WORKER_ERRORS = (OSError, TypeError, ValueError, RuntimeError, httpx.HTTPError)
SNAPSHOT_SCHEMA_VERSION = 1
LEASE_REFRESH_SECONDS = 30.0
LOGGER = logging.getLogger(__name__)


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
    config_root: Path
    poll_seconds: float = 10.0

    def __post_init__(self) -> None:
        if not self.server_url.startswith(("http://", "https://")):
            raise ValueError("worker server URL must use http or https")
        if not self.token:
            raise ValueError("training worker token is required")
        if not WORKER_ID.fullmatch(self.worker_id):
            raise ValueError("invalid training worker id")
        if self.poll_seconds <= 0:
            raise ValueError("poll interval must be positive")
        if not WORKER_DEVICE.fullmatch(self.device):
            raise ValueError("device must be cpu, mps, cuda, or cuda:<index>")


@dataclass(frozen=True)
class TrainingJob:
    run: dict[str, Any]

    @property
    def run_id(self) -> str:
        return str(self.run["id"])


@dataclass(frozen=True)
class SnapshotImage:
    digest: str
    extension: str
    split: str
    annotation: ReviewedImage


@dataclass(frozen=True)
class TrainingSnapshot:
    id: str
    dataset_id: str
    model_id: str
    images: tuple[SnapshotImage, ...]


def _snapshot_image(value: Any, context: str) -> SnapshotImage:
    entry = as_object(value, context)
    expect_fields(entry, {"digest", "extension", "split", "annotation"}, context)
    digest = as_digest(entry["digest"], f"{context}.digest")
    annotation = parse_annotation(entry["annotation"], f"{context}.annotation")
    if annotation.digest != digest:
        raise ValueError(f"{context}.annotation describes another image")
    if annotation.status != "complete":
        raise ValueError(f"{context}.annotation is not complete")
    return SnapshotImage(
        digest=digest,
        extension=as_extension(entry["extension"], f"{context}.extension"),
        split=as_split(entry["split"], f"{context}.split"),
        annotation=annotation,
    )


def parse_training_snapshot(value: Any, context: str = "snapshot") -> TrainingSnapshot:
    document = as_object(value, context)
    expect_fields(
        document,
        {"schemaVersion", "id", "datasetId", "modelId", "createdAt", "images"},
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
    return TrainingSnapshot(
        id=as_string(document["id"], f"{context}.id"),
        dataset_id=as_string(document["datasetId"], f"{context}.datasetId"),
        model_id=as_string(document["modelId"], f"{context}.modelId"),
        images=images,
    )


class TrainingWorkerClient:
    def __init__(
        self,
        server_url: str,
        token: str,
        worker_id: str,
        started_at: str,
        device: str,
        *,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.worker_id = worker_id
        self.started_at = started_at
        self.device = device
        self.current_run_id: str | None = None
        self._client = httpx.Client(
            base_url=server_url.rstrip("/") + "/",
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        response: httpx.Response | None = None
        for attempt in range(3):
            try:
                response = self._client.request(method, url, **kwargs)
            except httpx.TransportError:
                if attempt == 2:
                    raise
            else:
                if response.status_code not in {408, 429, 500, 502, 503, 504}:
                    return response
                if attempt == 2:
                    return response
                response.close()
            time.sleep(0.5 * 2**attempt)
        raise RuntimeError("HTTP retry loop ended without a response")

    def heartbeat(self) -> None:
        response = self._request(
            "POST",
            "api/training/heartbeat",
            json={
                "workerId": self.worker_id,
                "startedAt": self.started_at,
                "device": self.device,
                "currentTrainingRunId": self.current_run_id,
            },
        )
        response.raise_for_status()

    def claim(self) -> TrainingJob | None:
        response = self._request(
            "POST",
            "api/training/claim",
            json={"workerId": self.worker_id},
        )
        response.raise_for_status()
        document = response.json()
        if document.get("run") is None:
            return None
        if not isinstance(document.get("run"), dict):
            raise TypeError("Training claim response is invalid")
        return TrainingJob(document["run"])

    def snapshot(self, run_id: str) -> TrainingSnapshot:
        response = self._request(
            "GET",
            f"api/training/runs/{run_id}/snapshot",
            params={"workerId": self.worker_id},
        )
        if response.status_code == 409:
            raise TrainingLeaseLostError(response.text)
        response.raise_for_status()
        return parse_training_snapshot(response.json())

    def progress(self, run_id: str, phase: str, progress: float) -> None:
        response = self._request(
            "POST",
            f"api/training/runs/{run_id}/progress",
            json={
                "workerId": self.worker_id,
                "phase": phase,
                "progress": progress,
            },
        )
        if response.status_code == 409:
            raise TrainingLeaseLostError(response.text)
        response.raise_for_status()

    def image(self, run_id: str, digest: str) -> bytes:
        response = self._request(
            "GET",
            f"api/training/runs/{run_id}/images/{digest}",
            params={"workerId": self.worker_id},
        )
        if response.status_code == 409:
            raise TrainingLeaseLostError(response.text)
        response.raise_for_status()
        return verify_digest(response.content, digest)

    def artifact(self, run_id: str, weights: Path, inference: Path) -> None:
        response = self._request(
            "PUT",
            f"api/training/runs/{run_id}/artifact",
            data={"workerId": self.worker_id},
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

    def fail(self, run_id: str, error: str) -> None:
        response = self._request(
            "POST",
            f"api/training/runs/{run_id}/fail",
            json={"workerId": self.worker_id, "error": error[:2000]},
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
    snapshot = client.snapshot(job.run_id)
    if len(snapshot.images) < 2:
        raise ValueError("Training snapshot must contain at least two images")
    downloads = output.parent / "snapshot-images"
    downloads.mkdir(parents=True, exist_ok=True)
    dataset_images: list[DatasetImage] = []
    for image in snapshot.images:
        if cancelled and cancelled():
            raise YoloTrainingInterruptedError("training interrupted")
        downloaded = downloads / f"{image.digest}{image.extension}"
        downloaded.write_bytes(client.image(job.run_id, image.digest))
        dataset_images.append(
            DatasetImage(
                digest=image.digest,
                extension=image.extension,
                width=image.annotation.width,
                height=image.annotation.height,
                boxes=image.annotation.boxes,
                split=image.split,
                revision=image.annotation.revision,
                file_path=downloaded,
            )
        )
    export_dataset_images(dataset_images, output.parent, output)
    return output / "dataset.yaml"


@contextmanager
def _lease(
    client: TrainingWorkerClient,
    run_id: str,
    phase: str,
    progress: float,
    *,
    cancelled: Callable[[], bool] | None = None,
):
    closed = threading.Event()
    lost = threading.Event()
    refresh_errors: list[Exception] = []

    def refresh() -> None:
        while not closed.wait(LEASE_REFRESH_SECONDS):
            try:
                client.progress(run_id, phase, progress)
                client.heartbeat()
            except WORKER_ERRORS as error:
                refresh_errors.append(error)
                lost.set()
                return

    def should_stop() -> bool:
        return lost.is_set() or bool(cancelled and cancelled())

    client.progress(run_id, phase, progress)
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
    config_root: Path,
    stopped: threading.Event | None = None,
) -> None:
    def ensure_running() -> None:
        if stopped and stopped.is_set():
            raise YoloTrainingInterruptedError("training interrupted")

    client.current_run_id = job.run_id
    client.heartbeat()
    publication_started = False
    try:
        with tempfile.TemporaryDirectory(
            prefix="vitroflow-training-", dir=work_root
        ) as temporary:
            root = Path(temporary)
            client.progress(job.run_id, "preparing", 0.05)
            dataset = materialize_snapshot(
                client,
                job,
                root / "dataset",
                cancelled=stopped.is_set if stopped else None,
            )
            ensure_running()
            recipe = job.run["recipe"]
            config = (config_root / str(recipe["configuration"]["name"])).resolve()
            try:
                config.relative_to(config_root.resolve())
            except ValueError:
                raise ValueError(
                    "Training config escapes the configured root"
                ) from None
            with _lease(
                client,
                job.run_id,
                "training",
                0.1,
                cancelled=stopped.is_set if stopped else None,
            ) as cancelled:
                result = train_yolo_detector(
                    dataset,
                    root / "run",
                    config=config,
                    model=str(recipe["baseModel"]["reference"]),
                    model_digest=str(recipe["baseModel"]["digest"]),
                    config_digest=str(recipe["configuration"]["digest"]),
                    runtime_version=str(recipe["runtime"]["version"]),
                    device=client.device,
                    epochs=recipe.get("epochs"),
                    image_size=recipe.get("imageSize"),
                    batch_size=recipe.get("batchSize"),
                    cancelled=cancelled,
                )
            ensure_running()
            client.progress(job.run_id, "validating", 0.95)
            ensure_running()
            if result.confidence is None:
                raise RuntimeError(
                    "Training completed without a usable validation signal"
                )
            publication_started = True
            client.artifact(job.run_id, result.best_weights, result.summary)
    except YoloTrainingInterruptedError:
        raise
    except WORKER_ERRORS as error:
        if not isinstance(error, TrainingLeaseLostError) and (
            not publication_started or isinstance(error, TrainingArtifactRejectedError)
        ):
            client.fail(job.run_id, str(error) or type(error).__name__)
        raise
    finally:
        client.current_run_id = None
        client.heartbeat()


def run_training_worker(
    settings: TrainingWorkerSettings,
    *,
    on_ready: Callable[[], None] | None = None,
) -> int:
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    if not settings.config_root.is_dir():
        raise FileNotFoundError(settings.config_root)
    client = TrainingWorkerClient(
        settings.server_url,
        settings.token,
        settings.worker_id,
        datetime.now(UTC).isoformat(),
        settings.device,
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
                            client,
                            job,
                            settings.work_dir,
                            settings.config_root,
                            stopped=stopped,
                        )
                except YoloTrainingInterruptedError:
                    LOGGER.info("training interrupted; lease will be recoverable")
                except WORKER_ERRORS as error:
                    LOGGER.error("training worker error: %s", error)
                    job = None
                if not job:
                    stopped.wait(settings.poll_seconds)
            return 0
    finally:
        client.close()
