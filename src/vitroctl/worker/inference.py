from __future__ import annotations

import logging
import threading
import time
from collections import deque
from concurrent.futures import CancelledError, Future
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import httpx

from vitroctl.contracts.documents import as_digest, as_object, expect_fields
from vitroctl.contracts.validation import validate_wire_contract
from vitroctl.detectors.contract import DetectionFailure, DetectionProducer, Detector
from vitroctl.detectors.documents import InferenceOutcome
from vitroctl.io.image_io import verify_digest
from vitroctl.worker.images import DOWNLOADS, ImageCache, wait_for
from vitroctl.worker.model_store import ModelManifest, ModelStore
from vitroctl.worker.session import Lease, LeaseKeeper, LeaseLostError, WorkerClient

WORKER_ERRORS = (OSError, ValueError, RuntimeError, cv2.error, httpx.HTTPError)
DETECTION_ERRORS = (OSError, ValueError, RuntimeError, cv2.error)
_ERROR_MESSAGE_LIMIT = 2000
# Tasks held beyond the one being detected: as many as the cache downloads
# beside it, so downloads up to this many times slower than detection stay
# hidden. Each is a lease other workers cannot take meanwhile.
LOOKAHEAD = DOWNLOADS - 1
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


class InferenceClient:
    """The inference protocol: claim a pair, fetch what it needs, report the outcome."""

    def __init__(self, worker: WorkerClient) -> None:
        self.worker = worker

    @property
    def identity(self) -> dict[str, str]:
        return self.worker.identity

    def claim(self) -> Assignment | None:
        response = self.worker.request(
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
        response = self.worker.request(
            "GET",
            f"api/worker/inference/model-versions/{version_id}/weights",
            timeout=None,
        )
        response.raise_for_status()
        return response.content

    def download(self, digest: str) -> bytes:
        response = self.worker.request("GET", f"api/worker/inference/images/{digest}")
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
        response = self.worker.request(
            "PUT",
            f"api/worker/inference/results/{version_id}/{digest}",
            params=self.identity,
            json=document,
        )
        self.worker.require_current_session(response)

    def release_claim(self, assignment: Assignment) -> None:
        response = self.worker.request(
            "DELETE",
            f"api/worker/inference/claims/{assignment.version_id}/{assignment.image}/lease",
            json=self.identity,
        )
        response.raise_for_status()

    def renew_lease(self, assignment: Assignment) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/inference/claims/{assignment.version_id}/{assignment.image}/lease",
            json=self.identity,
        )
        self.worker.require_current_session(response)


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


@dataclass(frozen=True)
class _Held:
    """A claimed task: its lease is kept and its image is on its way."""

    assignment: Assignment
    lease: Lease
    image: Future[Path]


class InferencePipeline:
    """
    Serves inference one image at a time while holding the next tasks: their
    images download while this one is detected, so the worker waits on the
    network only when a download takes longer than detecting the images
    ahead of it. Images come from the machine's cache, so a version that
    reads images another version already read fetches nothing.
    """

    def __init__(
        self, client: InferenceClient, models: ModelStore, images: ImageCache
    ) -> None:
        self.client = client
        self.models = models
        self.images = images
        self._leases = LeaseKeeper(client.worker)
        self._ahead: deque[_Held] = deque()

    def run_once(self, stopped: threading.Event | None = None) -> bool:
        """
        Complete at most one task. Returning whether work was claimed lets
        the outer loop drain the queue without an idle polling delay.
        """
        if stopped and stopped.is_set():
            return False
        current = self._ahead.popleft() if self._ahead else self._take(stopped)
        if current is None:
            return False
        try:
            self._fill(stopped)
            self._serve(current, stopped)
        finally:
            self._drop(current)
        return True

    def release(self) -> None:
        """Release the tasks taken ahead, before other work or shutdown."""
        while self._ahead:
            held = self._ahead.popleft()
            self._drop(held)
            try:
                self.client.release_claim(held.assignment)
            except WORKER_ERRORS as error:
                # The lease expires on its own; releasing it only hurries that.
                LOGGER.warning("could not release %s: %s", held.assignment.image, error)

    def close(self) -> None:
        """Release what is held ahead and stop keeping leases."""
        try:
            self.release()
        finally:
            self._leases.close()

    def _fill(self, stopped: threading.Event | None) -> None:
        """Taking ahead is an optimization; failing to only costs the overlap."""
        while len(self._ahead) < LOOKAHEAD:
            try:
                held = self._take(stopped)
            except WORKER_ERRORS as error:
                LOGGER.warning("could not claim ahead: %s", error)
                return
            if held is None:
                return
            self._ahead.append(held)

    def _take(self, stopped: threading.Event | None) -> _Held | None:
        if stopped and stopped.is_set():
            return None
        assignment = self.client.claim()
        if assignment is None:
            return None
        LOGGER.info("claimed %s with %s", assignment.image, assignment.version_id)
        lease = self._leases.hold(lambda: self.client.renew_lease(assignment))
        image = self.images.fetch(assignment.image, self.client.download)
        return _Held(assignment, lease, image)

    def _serve(self, held: _Held, stopped: threading.Event | None) -> None:
        assignment = held.assignment

        def cancelled() -> bool:
            return held.lease.lost or bool(stopped and stopped.is_set())

        try:
            detector = self.models.load(assignment.manifest)
        except WORKER_ERRORS as error:
            LOGGER.error("cannot load %s: %s", assignment.version_id, error)
            return
        started = time.monotonic()
        try:
            image_path = wait_for(held.image, cancelled)
        except CancelledError as error:
            raise LeaseLostError("Inference lease is no longer active") from error
        waited = time.monotonic() - started
        producer = DetectionProducer(
            assignment.version_id, detector.artifact_digest, detector.runtime
        )
        started = time.monotonic()
        outcome = inference_outcome(assignment.image, image_path, producer, detector)
        detected = time.monotonic() - started
        if cancelled():
            raise LeaseLostError("Inference lease is no longer active")
        self._leases.end(held.lease)  # a failed refresh surfaces before the result
        started = time.monotonic()
        self.client.put_result(
            assignment.version_id, assignment.image, outcome.to_dict()
        )
        LOGGER.info(
            "%s %s with %s (waited %.1fs for the image, detected in %.1fs, "
            "reported in %.1fs)",
            "failed" if isinstance(outcome, DetectionFailure) else "detected",
            assignment.image,
            assignment.version_id,
            waited,
            detected,
            time.monotonic() - started,
        )

    def _drop(self, held: _Held) -> None:
        try:
            self._leases.end(held.lease)
        except LeaseLostError:
            pass  # the task is over either way; a lost lease changes nothing now
        finally:
            self.images.release(held.assignment.image)
