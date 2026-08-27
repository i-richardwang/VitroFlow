from __future__ import annotations

import logging
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import cv2
import httpx

from .config import PipelineConfig
from .documents import (
    as_digest,
    as_extension,
    as_list,
    as_object,
    as_string,
    expect_fields,
)
from .identifiers import DATASET_NAME, WORKER_DEVICE, WORKER_ID
from .image_io import verify_digest
from .inference_models import ModelStore, parse_model_version
from .prelabelers import (
    PredictionProducer,
    Prelabeler,
    PrelabelFailure,
    RuntimeDescriptor,
    TraditionalPrelabeler,
    yolo_runtime_descriptor,
)
from .scoring import DEFAULT_MODEL
from .worker_runtime import shutdown_signals

WORKER_ERRORS = (OSError, ValueError, RuntimeError, cv2.error, httpx.HTTPError)
DETECTION_ERRORS = (OSError, ValueError, RuntimeError, cv2.error)
_ERROR_MESSAGE_LIMIT = 2000
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class InferenceWorkerSettings:
    server_url: str
    token: str
    worker_id: str
    work_dir: Path
    poll_seconds: float = 5.0
    device: str | None = None

    def __post_init__(self) -> None:
        if not self.server_url.startswith(("http://", "https://")):
            raise ValueError("worker server URL must use http or https")
        if not self.token:
            raise ValueError("worker token is required")
        if not WORKER_ID.fullmatch(self.worker_id):
            raise ValueError("invalid inference worker id")
        if self.poll_seconds <= 0:
            raise ValueError("poll interval must be positive")
        if self.device is not None and not WORKER_DEVICE.fullmatch(self.device):
            raise ValueError("device must be cpu, mps, cuda, or cuda:<index>")


@dataclass(frozen=True)
class PendingImage:
    """An image the workbench wants a prelabel for."""

    dataset: str
    digest: str
    extension: str

    @classmethod
    def parse(cls, value: Any, context: str = "pending image") -> PendingImage:
        entry = as_object(value, context)
        expect_fields(entry, {"dataset", "digest", "extension"}, context)
        dataset = as_string(entry["dataset"], f"{context}.dataset")
        if not DATASET_NAME.fullmatch(dataset):
            raise ValueError(f"{context}.dataset is invalid")
        return cls(
            dataset=dataset,
            digest=as_digest(entry["digest"], f"{context}.digest"),
            extension=as_extension(entry["extension"], f"{context}.extension"),
        )

    def to_dict(self) -> dict[str, str]:
        return {"dataset": self.dataset, "digest": self.digest}


@dataclass(frozen=True)
class Assignment:
    """The images the Server wants prelabelled with one model version."""

    model_version: dict[str, Any]
    images: tuple[PendingImage, ...]

    @classmethod
    def parse(cls, value: Any, context: str = "assignment") -> Assignment:
        entry = as_object(value, context)
        expect_fields(entry, {"modelVersion", "images"}, context)
        return cls(
            model_version=parse_model_version(
                entry["modelVersion"], f"{context}.modelVersion"
            ),
            images=tuple(
                PendingImage.parse(item, f"{context}.images[{index}]")
                for index, item in enumerate(
                    as_list(entry["images"], f"{context}.images")
                )
            ),
        )

    @property
    def version_id(self) -> str:
        return self.model_version["id"]


def available_runtimes() -> tuple[RuntimeDescriptor, ...]:
    """The adapters this process can execute; YOLO only when Ultralytics is installed."""
    runtimes = [TraditionalPrelabeler(PipelineConfig(), DEFAULT_MODEL).runtime]
    try:
        runtimes.append(yolo_runtime_descriptor())
    except RuntimeError:
        pass
    return tuple(runtimes)


@dataclass(frozen=True)
class WorkerRuntime:
    """What an inference process is: its name and the adapters it can run."""

    worker_id: str
    started_at: str
    runtimes: tuple[RuntimeDescriptor, ...]

    @classmethod
    def create(cls, worker_id: str) -> WorkerRuntime:
        return cls(worker_id, datetime.now(UTC).isoformat(), available_runtimes())

    def heartbeat(
        self, loaded: str | None, current: PendingImage | None
    ) -> dict[str, object]:
        return {
            "workerId": self.worker_id,
            "startedAt": self.started_at,
            "runtimes": [runtime.to_dict() for runtime in self.runtimes],
            "loaded": loaded,
            "current": current.to_dict() if current else None,
        }


class WorkerClient:
    def __init__(
        self,
        server_url: str,
        token: str,
        runtime: WorkerRuntime,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.runtime = runtime
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

    def heartbeat(self, loaded: str | None, current: PendingImage | None) -> None:
        response = self._request(
            "POST",
            "api/inference/heartbeat",
            json=self.runtime.heartbeat(loaded, current),
        )
        response.raise_for_status()

    def pending(self) -> tuple[Assignment, ...]:
        response = self._request(
            "GET",
            "api/inference/pending",
            params={"workerId": self.runtime.worker_id},
        )
        response.raise_for_status()
        assignments = as_list(
            as_object(response.json(), "pending").get("assignments"),
            "pending.assignments",
        )
        return tuple(
            Assignment.parse(item, f"pending.assignments[{index}]")
            for index, item in enumerate(assignments)
        )

    def weights(self, version_id: str) -> bytes:
        response = self._request(
            "GET",
            f"api/inference/model-versions/{version_id}/weights",
            timeout=None,
        )
        response.raise_for_status()
        return response.content

    def download(self, image: PendingImage) -> bytes:
        response = self._request("GET", f"api/inference/images/{image.digest}")
        response.raise_for_status()
        return verify_digest(response.content, image.digest)

    def put_prelabel(self, image: PendingImage, document: dict[str, object]) -> bool:
        """Store a prelabel; False means review or a new version owns the image."""
        response = self._request(
            "PUT",
            f"api/inference/prelabels/{image.dataset}/{image.digest}",
            params={"workerId": self.runtime.worker_id},
            json=document,
        )
        if response.status_code == 409:
            return False
        response.raise_for_status()
        return True


def report_heartbeat(
    client: WorkerClient, loaded: str | None, current: PendingImage | None
) -> None:
    """A missed heartbeat only delays the status shown in the workbench."""
    try:
        client.heartbeat(loaded, current)
    except WORKER_ERRORS as error:
        LOGGER.warning("heartbeat failed: %s", error)


def failure_document(
    image: PendingImage, producer: PredictionProducer, error: Exception
) -> dict[str, object]:
    """The prelabel recorded when detection cannot produce a result."""
    return PrelabelFailure(
        digest=image.digest,
        producer=producer,
        error=str(error)[:_ERROR_MESSAGE_LIMIT],
    ).to_dict()


def prelabel_document(
    image: PendingImage,
    image_path: Path,
    producer: PredictionProducer,
    prelabeler: Prelabeler,
) -> dict[str, object]:
    try:
        result = prelabeler.predict(image_path, image.digest, producer)
    except DETECTION_ERRORS as error:
        LOGGER.error("detection failed for %s: %s", image.digest, error)
        return failure_document(image, producer, error)
    return result.to_dict()


def process_image(
    client: WorkerClient,
    image: PendingImage,
    work_dir: Path,
    producer: PredictionProducer,
    prelabeler: Prelabeler,
) -> None:
    report_heartbeat(client, producer.model_version_id, image)
    image_path = work_dir / f"{image.digest}{image.extension}"
    image_path.write_bytes(client.download(image))
    try:
        document = prelabel_document(image, image_path, producer, prelabeler)
    finally:
        image_path.unlink(missing_ok=True)
    if client.put_prelabel(image, document):
        LOGGER.info("prelabelled %s/%s", image.dataset, image.digest)


def process_assignment(
    client: WorkerClient,
    assignment: Assignment,
    work_dir: Path,
    prelabeler: Prelabeler,
    stopped: threading.Event | None,
) -> None:
    producer = PredictionProducer(
        assignment.version_id, prelabeler.artifact_digest, prelabeler.runtime
    )
    for image in assignment.images:
        if stopped and stopped.is_set():
            return
        process_image(client, image, work_dir, producer, prelabeler)


def run_pass(
    client: WorkerClient,
    work_root: Path,
    store: ModelStore,
    stopped: threading.Event | None = None,
) -> bool:
    """
    Prelabel every pending image once; returns False when nothing was pending.
    A version that cannot be loaded is skipped so the others still progress.
    """
    report_heartbeat(client, store.loaded, None)
    assignments = client.pending()
    if not assignments:
        return False
    LOGGER.info(
        "%d pending images across %d versions",
        sum(len(assignment.images) for assignment in assignments),
        len(assignments),
    )
    with tempfile.TemporaryDirectory(prefix="vitroflow-", dir=work_root) as temporary:
        for assignment in assignments:
            if stopped and stopped.is_set():
                break
            try:
                prelabeler = store.load(assignment.model_version)
            except WORKER_ERRORS as error:
                LOGGER.error("cannot load %s: %s", assignment.version_id, error)
                continue
            process_assignment(client, assignment, Path(temporary), prelabeler, stopped)
    report_heartbeat(client, store.loaded, None)
    return True


def run_inference_worker(
    settings: InferenceWorkerSettings,
    *,
    on_ready: Callable[[], None] | None = None,
) -> int:
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    client = WorkerClient(
        settings.server_url, settings.token, WorkerRuntime.create(settings.worker_id)
    )
    store = ModelStore(client, settings.work_dir, settings.device)
    try:
        with shutdown_signals() as stopped:
            client.heartbeat(None, None)
            if on_ready:
                on_ready()
            while not stopped.is_set():
                try:
                    processed = run_pass(
                        client, settings.work_dir, store, stopped=stopped
                    )
                except WORKER_ERRORS as error:
                    LOGGER.error("inference worker error: %s", error)
                    processed = False
                if not processed:
                    stopped.wait(settings.poll_seconds)
            return 0
    finally:
        store.unload()
        client.close()
