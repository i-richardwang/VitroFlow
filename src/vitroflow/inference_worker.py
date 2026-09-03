from __future__ import annotations

import logging
import tempfile
import threading
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

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
from .documents import as_digest, as_object, as_string, expect_fields
from .image_io import CANONICAL_EXTENSION, verify_digest
from .inference_models import ModelManifest, ModelStore
from .scoring import DEFAULT_MODEL
from .wire_contracts import validate_wire_contract
from .worker_connection import (
    WorkerConnection,
    WorkerHttpClient,
    validate_worker_process,
)
from .worker_runtime import shutdown_signals
from .yolo.runtime import ultralytics_installed

WORKER_ERRORS = (OSError, ValueError, RuntimeError, cv2.error, httpx.HTTPError)
DETECTION_ERRORS = (OSError, ValueError, RuntimeError, cv2.error)
_ERROR_MESSAGE_LIMIT = 2000
LEASE_REFRESH_SECONDS = 30.0
LOGGER = logging.getLogger(__name__)


class InferenceLeaseLostError(RuntimeError):
    pass


@dataclass(frozen=True)
class InferenceWorkerSettings:
    server_url: str
    token: str
    worker_id: str
    work_dir: Path
    poll_seconds: float = 5.0
    device: str | None = None

    def __post_init__(self) -> None:
        WorkerConnection(server_url=self.server_url, token=self.token)
        validate_worker_process(self.worker_id, self.poll_seconds, self.device)


@dataclass(frozen=True)
class Assignment:
    """One image-version task leased by the Server to this worker session."""

    manifest: ModelManifest
    image: str
    lease_expires_at: str

    @classmethod
    def parse(cls, value: Any, context: str = "assignment") -> Assignment:
        validate_wire_contract("inference-assignment", value, context)
        entry = as_object(value, context)
        expect_fields(entry, {"manifest", "image", "leaseExpiresAt"}, context)
        lease_expires_at = as_string(
            entry["leaseExpiresAt"], f"{context}.leaseExpiresAt"
        )
        lease = datetime.fromisoformat(lease_expires_at)
        if lease.tzinfo is None:
            raise ValueError(f"{context}.leaseExpiresAt must include an offset")
        return cls(
            manifest=ModelManifest.parse(entry["manifest"], f"{context}.manifest"),
            image=as_digest(entry["image"], f"{context}.image"),
            lease_expires_at=lease_expires_at,
        )

    @property
    def version_id(self) -> str:
        return self.manifest.model_version_id


def available_runtimes() -> tuple[RuntimeDescriptor, ...]:
    runtimes = [TraditionalDetector(PipelineConfig(), DEFAULT_MODEL).runtime]
    if ultralytics_installed():
        runtimes.append(ultralytics_runtime_descriptor())
    return tuple(runtimes)


@dataclass(frozen=True)
class WorkerRuntime:
    """What an inference process is: its name and the adapters it can run."""

    worker_id: str
    session_id: str
    started_at: str
    runtimes: tuple[RuntimeDescriptor, ...]

    @classmethod
    def create(cls, worker_id: str) -> WorkerRuntime:
        return cls(
            worker_id,
            f"session-{uuid4()}",
            datetime.now(UTC).isoformat(),
            available_runtimes(),
        )

    def heartbeat(self, loaded: str | None, current: str | None) -> dict[str, object]:
        return {
            "workerId": self.worker_id,
            "sessionId": self.session_id,
            "startedAt": self.started_at,
            "runtimes": [runtime.to_dict() for runtime in self.runtimes],
            "loaded": loaded,
            "current": current,
        }


class WorkerClient(WorkerHttpClient):
    def __init__(
        self,
        server_url: str,
        token: str,
        runtime: WorkerRuntime,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.runtime = runtime
        super().__init__(
            WorkerConnection(server_url=server_url, token=token),
            timeout=timeout,
            transport=transport,
        )

    @property
    def identity(self) -> dict[str, str]:
        return {
            "workerId": self.runtime.worker_id,
            "sessionId": self.runtime.session_id,
        }

    def heartbeat(self, loaded: str | None, current: str | None) -> None:
        response = self.request(
            "POST",
            "api/inference/heartbeat",
            json=self.runtime.heartbeat(loaded, current),
        )
        response.raise_for_status()

    def claim(self) -> Assignment | None:
        response = self.request(
            "POST",
            "api/inference/claim",
            json=self.identity,
        )
        response.raise_for_status()
        assignment = as_object(response.json(), "claim").get("assignment")
        return (
            None
            if assignment is None
            else Assignment.parse(assignment, "claim.assignment")
        )

    def weights(self, version_id: str) -> bytes:
        response = self.request(
            "GET",
            f"api/inference/model-versions/{version_id}/weights",
            timeout=None,
        )
        response.raise_for_status()
        return response.content

    def download(self, digest: str) -> bytes:
        response = self.request("GET", f"api/inference/images/{digest}")
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
        response = self.request(
            "PUT",
            f"api/inference/results/{version_id}/{digest}",
            params=self.identity,
            json=document,
        )
        if response.status_code == 409:
            raise InferenceLeaseLostError(response.text)
        response.raise_for_status()

    def renew_lease(self, assignment: Assignment) -> None:
        response = self.request(
            "POST",
            f"api/inference/claims/{assignment.version_id}/{assignment.image}/lease",
            json=self.identity,
        )
        if response.status_code == 409:
            raise InferenceLeaseLostError(response.text)
        response.raise_for_status()


def report_heartbeat(
    client: WorkerClient, loaded: str | None, current: str | None
) -> None:
    """A missed heartbeat only delays the status shown in the workbench."""
    try:
        client.heartbeat(loaded, current)
    except WORKER_ERRORS as error:
        LOGGER.warning("heartbeat failed: %s", error)


@contextmanager
def _lease(
    client: WorkerClient,
    assignment: Assignment,
    *,
    cancelled: Callable[[], bool] | None = None,
):
    """Keep one inference claim live while model loading and prediction run."""
    closed = threading.Event()
    lost = threading.Event()
    refresh_errors: list[Exception] = []

    def refresh() -> None:
        while not closed.wait(LEASE_REFRESH_SECONDS):
            try:
                client.renew_lease(assignment)
                report_heartbeat(client, assignment.version_id, assignment.image)
            except Exception as error:  # noqa: BLE001 - process boundary owns the lease
                refresh_errors.append(error)
                lost.set()
                return

    def should_stop() -> bool:
        return lost.is_set() or bool(cancelled and cancelled())

    client.renew_lease(assignment)
    thread = threading.Thread(target=refresh, name="inference-lease", daemon=True)
    thread.start()
    try:
        yield should_stop
    finally:
        closed.set()
        thread.join()
        if refresh_errors:
            raise InferenceLeaseLostError("Inference lease refresh failed") from (
                refresh_errors[0]
            )


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
    cancelled: Callable[[], bool] | None = None,
) -> InferenceOutcome:
    report_heartbeat(client, producer.model_version_id, digest)
    image_path = work_dir / f"{digest}{CANONICAL_EXTENSION}"
    image_path.write_bytes(client.download(digest))
    try:
        outcome = inference_outcome(digest, image_path, producer, detector)
    finally:
        image_path.unlink(missing_ok=True)
    if cancelled and cancelled():
        raise InferenceLeaseLostError("Inference lease is no longer active")
    return outcome


def process_assignment(
    client: WorkerClient,
    assignment: Assignment,
    work_dir: Path,
    detector: Detector,
    cancelled: Callable[[], bool] | None = None,
) -> InferenceOutcome:
    producer = DetectionProducer(
        assignment.version_id, detector.artifact_digest, detector.runtime
    )
    return process_image(
        client,
        assignment.image,
        work_dir,
        producer,
        detector,
        cancelled=cancelled,
    )


def run_pass(
    client: WorkerClient,
    work_root: Path,
    store: ModelStore,
    stopped: threading.Event | None = None,
) -> bool:
    """
    Claim and process at most one task. Returning whether work was claimed lets
    the outer loop drain the queue without an idle polling delay.
    """
    report_heartbeat(client, store.loaded, None)
    if stopped and stopped.is_set():
        return False
    assignment = client.claim()
    if assignment is None:
        return False
    LOGGER.info("claimed %s with %s", assignment.image, assignment.version_id)
    with (
        tempfile.TemporaryDirectory(prefix="vitroflow-", dir=work_root) as temporary,
        _lease(
            client,
            assignment,
            cancelled=stopped.is_set if stopped else None,
        ) as cancelled,
    ):
        try:
            detector = store.load(assignment.manifest)
        except WORKER_ERRORS as error:
            LOGGER.error("cannot load %s: %s", assignment.version_id, error)
            return True
        outcome = process_assignment(
            client,
            assignment,
            Path(temporary),
            detector,
            cancelled=cancelled,
        )
    client.put_result(assignment.version_id, assignment.image, outcome.to_dict())
    if isinstance(outcome, DetectionFailure):
        LOGGER.info(
            "recorded failure for %s with %s",
            assignment.image,
            assignment.version_id,
        )
    else:
        LOGGER.info("detected %s with %s", assignment.image, assignment.version_id)
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
                    worked = run_pass(client, settings.work_dir, store, stopped=stopped)
                except WORKER_ERRORS as error:
                    LOGGER.error("inference worker error: %s", error)
                    worked = False
                if not worked:
                    stopped.wait(settings.poll_seconds)
            return 0
    finally:
        store.unload()
        client.close()
