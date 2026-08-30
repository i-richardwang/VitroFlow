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
from .detectors import (
    DetectionFailure,
    DetectionProducer,
    Detector,
    InferenceOutcome,
    RuntimeDescriptor,
    TraditionalDetector,
    ultralytics_runtime_descriptor,
)
from .documents import as_digest, as_list, as_object, expect_fields
from .identifiers import WORKER_DEVICE, WORKER_ID
from .image_io import CANONICAL_EXTENSION, verify_digest
from .inference_models import ModelManifest, ModelStore
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
class Assignment:
    """The images, by digest, the Server wants detected with one model version."""

    manifest: ModelManifest
    images: tuple[str, ...]

    @classmethod
    def parse(cls, value: Any, context: str = "assignment") -> Assignment:
        entry = as_object(value, context)
        expect_fields(entry, {"manifest", "images"}, context)
        images = tuple(
            as_digest(item, f"{context}.images[{index}]")
            for index, item in enumerate(as_list(entry["images"], f"{context}.images"))
        )
        if not images:
            raise ValueError(f"{context}.images must not be empty")
        return cls(
            manifest=ModelManifest.parse(entry["manifest"], f"{context}.manifest"),
            images=images,
        )

    @property
    def version_id(self) -> str:
        return self.manifest.model_version_id


def available_runtimes() -> tuple[RuntimeDescriptor, ...]:
    """The adapters this process can execute; YOLO only when Ultralytics is installed."""
    runtimes = [TraditionalDetector(PipelineConfig(), DEFAULT_MODEL).runtime]
    try:
        runtimes.append(ultralytics_runtime_descriptor())
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

    def heartbeat(self, loaded: str | None, current: str | None) -> dict[str, object]:
        return {
            "workerId": self.worker_id,
            "startedAt": self.started_at,
            "runtimes": [runtime.to_dict() for runtime in self.runtimes],
            "loaded": loaded,
            "current": current,
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

    def heartbeat(self, loaded: str | None, current: str | None) -> None:
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

    def download(self, digest: str) -> bytes:
        response = self._request("GET", f"api/inference/images/{digest}")
        response.raise_for_status()
        return verify_digest(response.content, digest)

    def put_result(
        self, version_id: str, digest: str, document: dict[str, object]
    ) -> None:
        """
        Records the outcome for the pair. The Server accepts a repeated
        identical detection and a failure that arrives after a detection; it
        refuses a detection that differs from the one it already holds, which
        is an inconsistency worth surfacing rather than a stale assignment.
        """
        response = self._request(
            "PUT",
            f"api/inference/results/{version_id}/{digest}",
            params={"workerId": self.runtime.worker_id},
            json=document,
        )
        response.raise_for_status()


def report_heartbeat(
    client: WorkerClient, loaded: str | None, current: str | None
) -> None:
    """A missed heartbeat only delays the status shown in the workbench."""
    try:
        client.heartbeat(loaded, current)
    except WORKER_ERRORS as error:
        LOGGER.warning("heartbeat failed: %s", error)


def inference_outcome(
    digest: str,
    image_path: Path,
    producer: DetectionProducer,
    detector: Detector,
) -> InferenceOutcome:
    try:
        result = detector.predict(image_path, digest, producer)
    except DETECTION_ERRORS as error:
        LOGGER.error("detection failed for %s: %s", digest, error)
        return DetectionFailure(
            digest=digest,
            producer=producer,
            error=str(error)[:_ERROR_MESSAGE_LIMIT],
        )
    return result


def process_image(
    client: WorkerClient,
    digest: str,
    work_dir: Path,
    producer: DetectionProducer,
    detector: Detector,
) -> None:
    report_heartbeat(client, producer.model_version_id, digest)
    image_path = work_dir / f"{digest}{CANONICAL_EXTENSION}"
    image_path.write_bytes(client.download(digest))
    try:
        outcome = inference_outcome(digest, image_path, producer, detector)
    finally:
        image_path.unlink(missing_ok=True)
    client.put_result(producer.model_version_id, digest, outcome.to_dict())
    if isinstance(outcome, DetectionFailure):
        LOGGER.info(
            "recorded failure for %s with %s", digest, producer.model_version_id
        )
    else:
        LOGGER.info("detected %s with %s", digest, producer.model_version_id)


def process_assignment(
    client: WorkerClient,
    assignment: Assignment,
    work_dir: Path,
    detector: Detector,
    stopped: threading.Event | None,
) -> None:
    producer = DetectionProducer(
        assignment.version_id, detector.artifact_digest, detector.runtime
    )
    for digest in assignment.images:
        if stopped and stopped.is_set():
            return
        process_image(client, digest, work_dir, producer, detector)


def run_pass(
    client: WorkerClient,
    work_root: Path,
    store: ModelStore,
    stopped: threading.Event | None = None,
) -> None:
    """
    Process one snapshot of pending work. A version that cannot be loaded is
    skipped so the other assignments still progress.
    """
    report_heartbeat(client, store.loaded, None)
    assignments = client.pending()
    if not assignments:
        return
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
                detector = store.load(assignment.manifest)
            except WORKER_ERRORS as error:
                LOGGER.error("cannot load %s: %s", assignment.version_id, error)
                continue
            process_assignment(client, assignment, Path(temporary), detector, stopped)
    report_heartbeat(client, store.loaded, None)


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
                    run_pass(client, settings.work_dir, store, stopped=stopped)
                except WORKER_ERRORS as error:
                    LOGGER.error("inference worker error: %s", error)
                stopped.wait(settings.poll_seconds)
            return 0
    finally:
        store.unload()
        client.close()
