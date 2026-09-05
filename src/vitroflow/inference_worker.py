from __future__ import annotations

import logging
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import httpx

from .detectors import (
    DetectionFailure,
    DetectionProducer,
    Detector,
    InferenceOutcome,
)
from .documents import as_digest, as_object, expect_fields
from .image_io import CANONICAL_EXTENSION, verify_digest
from .inference_models import ModelManifest, ModelStore
from .wire_contracts import validate_wire_contract
from .worker_runtime import shutdown_signals
from .worker_session import (
    LeaseLostError,
    WorkerClient,
    WorkerSession,
    WorkerSettings,
    keep_lease,
)

WORKER_ERRORS = (OSError, ValueError, RuntimeError, cv2.error, httpx.HTTPError)
DETECTION_ERRORS = (OSError, ValueError, RuntimeError, cv2.error)
_ERROR_MESSAGE_LIMIT = 2000
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class Assignment:
    """One image-version task leased by the Server to this worker session."""

    manifest: ModelManifest
    image: str

    @classmethod
    def parse(cls, value: Any, context: str = "assignment") -> Assignment:
        validate_wire_contract("inference-assignment", value, context)
        entry = as_object(value, context)
        expect_fields(entry, {"manifest", "image"}, context)
        return cls(
            manifest=ModelManifest.parse(entry["manifest"], f"{context}.manifest"),
            image=as_digest(entry["image"], f"{context}.image"),
        )

    @property
    def version_id(self) -> str:
        return self.manifest.model_version_id


class InferenceClient(WorkerClient):
    """The inference protocol: claim a pair, fetch what it needs, report the outcome."""

    def claim(self) -> Assignment | None:
        response = self.request(
            "POST",
            "api/worker/inference/claim",
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
            f"api/worker/inference/model-versions/{version_id}/weights",
            timeout=None,
        )
        response.raise_for_status()
        return response.content

    def download(self, digest: str) -> bytes:
        response = self.request("GET", f"api/worker/inference/images/{digest}")
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
            f"api/worker/inference/results/{version_id}/{digest}",
            params=self.identity,
            json=document,
        )
        self.require_current_session(response)

    def renew_lease(self, assignment: Assignment) -> None:
        response = self.request(
            "POST",
            f"api/worker/inference/claims/{assignment.version_id}/{assignment.image}/lease",
            json=self.identity,
        )
        self.require_current_session(response)


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
    client: InferenceClient,
    digest: str,
    work_dir: Path,
    producer: DetectionProducer,
    detector: Detector,
    cancelled: Callable[[], bool] | None = None,
) -> InferenceOutcome:
    image_path = work_dir / f"{digest}{CANONICAL_EXTENSION}"
    image_path.write_bytes(client.download(digest))
    try:
        outcome = inference_outcome(digest, image_path, producer, detector)
    finally:
        image_path.unlink(missing_ok=True)
    if cancelled and cancelled():
        raise LeaseLostError("Inference lease is no longer active")
    return outcome


def process_assignment(
    client: InferenceClient,
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
    client: InferenceClient,
    work_root: Path,
    store: ModelStore,
    stopped: threading.Event | None = None,
) -> bool:
    """
    Claim and process at most one task. Returning whether work was claimed lets
    the outer loop drain the queue without an idle polling delay.
    """
    client.report_heartbeat()
    if stopped and stopped.is_set():
        return False
    assignment = client.claim()
    if assignment is None:
        return False
    LOGGER.info("claimed %s with %s", assignment.image, assignment.version_id)
    with (
        tempfile.TemporaryDirectory(prefix="vitroflow-", dir=work_root) as temporary,
        keep_lease(
            client,
            lambda: client.renew_lease(assignment),
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
    return True


def run_inference_worker(
    settings: WorkerSettings,
    *,
    on_ready: Callable[[], None] | None = None,
) -> int:
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    client = InferenceClient(
        settings.server_url,
        settings.token,
        WorkerSession.create(settings.worker_id, settings.device),
    )
    store = ModelStore(client, settings.work_dir, settings.device)
    try:
        with shutdown_signals() as stopped:
            client.heartbeat()
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
