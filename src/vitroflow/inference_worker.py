from __future__ import annotations

import json
import logging
import shutil
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
from .documents import as_digest, as_extension, as_object, as_string, expect_fields
from .identifiers import DATASET_NAME, VERSION_ID, WORKER_DEVICE, WORKER_ID
from .image_io import verify_digest
from .prelabelers import (
    PredictionProducer,
    Prelabeler,
    PrelabelFailure,
    RuntimeDescriptor,
    TraditionalPrelabeler,
    YoloPrelabeler,
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
    model_version_id: str
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
        if not VERSION_ID.fullmatch(self.model_version_id):
            raise ValueError("valid model version id is required")
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
class WorkerIdentity:
    """One immutable model deployment served by an inference process."""

    worker_id: str
    started_at: str
    model_version_id: str
    artifact_digest: str
    runtime: RuntimeDescriptor

    @classmethod
    def create(
        cls, worker_id: str, model_version_id: str, prelabeler: Prelabeler
    ) -> WorkerIdentity:
        return cls(
            worker_id,
            datetime.now(UTC).isoformat(),
            model_version_id,
            prelabeler.artifact_digest,
            prelabeler.runtime,
        )

    @property
    def producer(self) -> PredictionProducer:
        return PredictionProducer(
            self.model_version_id,
            self.artifact_digest,
            self.runtime,
        )

    def heartbeat(self, current: PendingImage | None) -> dict[str, object]:
        return {
            "workerId": self.worker_id,
            "startedAt": self.started_at,
            "deployment": {
                "modelVersionId": self.model_version_id,
                "artifactDigest": self.artifact_digest,
            },
            "runtime": self.runtime.to_dict(),
            "current": current.to_dict() if current else None,
        }

    def failure(self, image: PendingImage, error: Exception) -> dict[str, object]:
        """The prelabel document recorded when detection cannot produce a result."""
        return PrelabelFailure(
            digest=image.digest,
            producer=self.producer,
            error=str(error)[:_ERROR_MESSAGE_LIMIT],
        ).to_dict()


class WorkerClient:
    def __init__(
        self,
        server_url: str,
        token: str,
        identity: WorkerIdentity,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.identity = identity
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

    def heartbeat(self, current: PendingImage | None) -> None:
        response = self._request(
            "POST", "api/inference/heartbeat", json=self.identity.heartbeat(current)
        )
        response.raise_for_status()

    def pending(self) -> tuple[PendingImage, ...]:
        response = self._request(
            "GET",
            "api/inference/pending",
            params={"workerId": self.identity.worker_id},
        )
        response.raise_for_status()
        images = response.json().get("images")
        if not isinstance(images, list):
            raise TypeError("Pending response must contain an images array")
        return tuple(
            PendingImage.parse(item, f"pending.images[{index}]")
            for index, item in enumerate(images)
        )

    def download(self, image: PendingImage) -> bytes:
        response = self._request("GET", f"api/inference/images/{image.digest}")
        response.raise_for_status()
        return verify_digest(response.content, image.digest)

    def put_prelabel(self, image: PendingImage, document: dict[str, object]) -> bool:
        """Store a prelabel; False means review or a new version owns the image."""
        response = self._request(
            "PUT",
            f"api/inference/prelabels/{image.dataset}/{image.digest}",
            params={"workerId": self.identity.worker_id},
            json=document,
        )
        if response.status_code == 409:
            return False
        response.raise_for_status()
        return True


def report_heartbeat(client: WorkerClient, current: PendingImage | None) -> None:
    """A missed heartbeat only delays the status shown in the workbench."""
    try:
        client.heartbeat(current)
    except WORKER_ERRORS as error:
        LOGGER.warning("heartbeat failed: %s", error)


def prelabel_document(
    image: PendingImage,
    image_path: Path,
    identity: WorkerIdentity,
    prelabeler: Prelabeler,
) -> dict[str, object]:
    try:
        result = prelabeler.predict(image_path, image.digest, identity.producer)
    except DETECTION_ERRORS as error:
        LOGGER.error("detection failed for %s: %s", image.digest, error)
        return identity.failure(image, error)
    return result.to_dict()


def process_image(
    client: WorkerClient,
    image: PendingImage,
    work_dir: Path,
    prelabeler: Prelabeler,
) -> None:
    report_heartbeat(client, image)
    image_path = work_dir / f"{image.digest}{image.extension}"
    image_path.write_bytes(client.download(image))
    try:
        document = prelabel_document(image, image_path, client.identity, prelabeler)
    finally:
        image_path.unlink(missing_ok=True)
    if client.put_prelabel(image, document):
        LOGGER.info("prelabelled %s/%s", image.dataset, image.digest)


def run_pass(
    client: WorkerClient,
    work_root: Path,
    prelabeler: Prelabeler,
    stopped: threading.Event | None = None,
) -> bool:
    """Prelabel every pending image once; returns False when nothing was pending."""
    report_heartbeat(client, None)
    images = client.pending()
    if not images:
        return False
    LOGGER.info("%d pending images", len(images))
    with tempfile.TemporaryDirectory(prefix="vitroflow-", dir=work_root) as temporary:
        for image in images:
            if stopped and stopped.is_set():
                break
            process_image(client, image, Path(temporary), prelabeler)
    report_heartbeat(client, None)
    return True


def deployment_manifest(settings: InferenceWorkerSettings) -> dict[str, Any]:
    response = httpx.get(
        f"{settings.server_url.rstrip('/')}/api/inference/model-versions/"
        f"{settings.model_version_id}",
        headers={"Authorization": f"Bearer {settings.token}"},
        timeout=120,
    )
    response.raise_for_status()
    manifest = response.json()
    if (
        not isinstance(manifest, dict)
        or manifest.get("id") != settings.model_version_id
    ):
        raise ValueError("Server returned an invalid model version manifest")
    artifact = manifest.get("artifact")
    if not isinstance(artifact, dict) or artifact.get("kind") not in {
        "traditional",
        "ultralytics",
    }:
        raise ValueError("Model version has an unsupported artifact")
    return manifest


def _remote_yolo_run(
    settings: InferenceWorkerSettings, artifact: dict[str, Any]
) -> Path:
    expected_digest = artifact.get("digest")
    expected_bytes = artifact.get("bytes")
    inference = artifact.get("inference")
    validation = artifact.get("validation")
    training = artifact.get("training")
    if (
        not isinstance(expected_digest, str)
        or not isinstance(expected_bytes, int)
        or not isinstance(inference, dict)
        or not isinstance(validation, dict)
        or not isinstance(training, dict)
    ):
        raise TypeError("Published YOLO artifact manifest is invalid")
    destination = settings.work_dir / "model-artifacts" / settings.model_version_id
    if destination.exists():
        cached = YoloPrelabeler.from_run(destination, device=settings.device)
        if cached.artifact_digest != expected_digest:
            raise ValueError(
                "Cached YOLO artifact does not match the published version"
            )
        return destination

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(
            prefix=f".{settings.model_version_id}.", dir=destination.parent
        )
    )
    try:
        weights = temporary / "weights" / "best.pt"
        weights.parent.mkdir(parents=True)
        response = httpx.get(
            f"{settings.server_url.rstrip('/')}/api/inference/model-versions/"
            f"{settings.model_version_id}/weights",
            headers={"Authorization": f"Bearer {settings.token}"},
            timeout=None,
        )
        response.raise_for_status()
        if len(response.content) != expected_bytes:
            raise ValueError("Downloaded YOLO weights have an unexpected size")
        weights.write_bytes(response.content)
        (temporary / "inference.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "weights": "weights/best.pt",
                    "inference": {
                        "ready": True,
                        "confidence": inference.get("confidence"),
                        "imgsz": inference.get("imageSize"),
                        "max_det": inference.get("maxDetections"),
                        "end2end": inference.get("endToEnd"),
                    },
                    "validation": validation,
                    "training": {
                        "base_model": training.get("baseModel"),
                        "configuration": training.get("configuration"),
                        "runtime": training.get("runtime"),
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        downloaded = YoloPrelabeler.from_run(temporary, device=settings.device)
        if downloaded.artifact_digest != expected_digest:
            raise ValueError("Downloaded YOLO artifact failed digest verification")
        try:
            temporary.rename(destination)
        except FileExistsError:
            pass
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return destination


def build_prelabeler(settings: InferenceWorkerSettings) -> Prelabeler:
    manifest = deployment_manifest(settings)
    artifact = manifest["artifact"]
    if artifact["kind"] == "ultralytics":
        run = _remote_yolo_run(settings, artifact)
        prelabeler = YoloPrelabeler.from_run(run, device=settings.device)
    else:
        if settings.device:
            raise ValueError("device only applies to YOLO prelabelling")
        prelabeler = TraditionalPrelabeler(PipelineConfig(), DEFAULT_MODEL)
    if prelabeler.artifact_digest != artifact.get("digest"):
        raise ValueError(
            "Local inference artifact does not match the published version"
        )
    return prelabeler


def run_inference_worker(
    settings: InferenceWorkerSettings,
    *,
    on_ready: Callable[[], None] | None = None,
) -> int:
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    prelabeler = build_prelabeler(settings)
    identity = WorkerIdentity.create(
        settings.worker_id,
        settings.model_version_id,
        prelabeler,
    )
    client = WorkerClient(settings.server_url, settings.token, identity)
    try:
        with shutdown_signals() as stopped:
            client.heartbeat(None)
            if on_ready:
                on_ready()
            while not stopped.is_set():
                try:
                    processed = run_pass(
                        client, settings.work_dir, prelabeler, stopped=stopped
                    )
                except WORKER_ERRORS as error:
                    LOGGER.error("inference worker error: %s", error)
                    processed = False
                if not processed:
                    stopped.wait(settings.poll_seconds)
            return 0
    finally:
        client.close()
