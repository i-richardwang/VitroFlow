from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import cv2
import httpx

from .config import PipelineConfig
from .prelabelers import (
    PredictionProducer,
    Prelabeler,
    PrelabelFailure,
    RuntimeDescriptor,
    TraditionalPrelabeler,
    YoloPrelabeler,
)
from .scoring import DEFAULT_MODEL, load_candidate_model
from .worker_runtime import health_server

WORKER_ERRORS = (OSError, ValueError, RuntimeError, cv2.error, httpx.HTTPError)
DETECTION_ERRORS = (OSError, ValueError, RuntimeError, cv2.error)
WORKER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
VERSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_ERROR_MESSAGE_LIMIT = 2000


@dataclass(frozen=True)
class PendingImage:
    """An image the workbench wants a prelabel for."""

    dataset: str
    stem: str
    source: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PendingImage:
        values = []
        for key in ("dataset", "stem", "source"):
            value = data.get(key)
            if not isinstance(value, str) or not value:
                raise ValueError(f"Pending image is missing {key}")
            values.append(value)
        return cls(*values)

    def to_dict(self) -> dict[str, str]:
        return {"dataset": self.dataset, "stem": self.stem}


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
            source=Path(image.source),
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
        return tuple(PendingImage.from_dict(item) for item in images)

    def download(self, image: PendingImage) -> bytes:
        response = self._request(
            "GET", f"api/inference/images/{image.dataset}/{image.stem}"
        )
        response.raise_for_status()
        return response.content

    def put_prelabel(self, image: PendingImage, document: dict[str, object]) -> bool:
        """Store a prelabel; False means review or a new version owns the image."""
        response = self._request(
            "PUT",
            f"api/inference/prelabels/{image.dataset}/{image.stem}",
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
        print(f"heartbeat failed: {error}", file=sys.stderr, flush=True)


def prelabel_document(
    image: PendingImage,
    image_path: Path,
    identity: WorkerIdentity,
    prelabeler: Prelabeler,
) -> dict[str, object]:
    try:
        result = prelabeler.predict(
            image_path,
            Path(image.source),
            identity.producer,
        )
    except DETECTION_ERRORS as error:
        print(f"detection failed for {image.source}: {error}", file=sys.stderr)
        return identity.failure(image, error)
    return result.to_dict()


def process_image(
    client: WorkerClient,
    image: PendingImage,
    work_dir: Path,
    prelabeler: Prelabeler,
) -> None:
    report_heartbeat(client, image)
    suffix = Path(image.source).suffix.lower() or ".jpg"
    image_path = work_dir / f"{image.dataset}-{image.stem}{suffix}"
    image_path.write_bytes(client.download(image))
    try:
        document = prelabel_document(image, image_path, client.identity, prelabeler)
    finally:
        image_path.unlink(missing_ok=True)
    if client.put_prelabel(image, document):
        print(f"prelabelled {image.source}", flush=True)


def run_pass(
    client: WorkerClient,
    work_root: Path,
    prelabeler: Prelabeler,
) -> bool:
    """Prelabel every pending image once; returns False when nothing was pending."""
    report_heartbeat(client, None)
    images = client.pending()
    if not images:
        return False
    print(f"{len(images)} pending images", flush=True)
    with tempfile.TemporaryDirectory(prefix="vitroflow-", dir=work_root) as temporary:
        for image in images:
            process_image(client, image, Path(temporary), prelabeler)
    report_heartbeat(client, None)
    return True


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vitroflow-inference-worker",
        description="Prelabel pending images of a VitroFlow workbench.",
    )
    parser.add_argument(
        "--server",
        default=os.environ.get("VITROFLOW_SERVER_URL"),
        help="Workbench base URL (or VITROFLOW_SERVER_URL)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("VITROFLOW_INFERENCE_WORKER_TOKEN"),
        help="Inference Worker bearer token (or VITROFLOW_INFERENCE_WORKER_TOKEN)",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path(
            os.environ.get("VITROFLOW_INFERENCE_WORK_DIR", tempfile.gettempdir())
        ),
    )
    parser.add_argument(
        "--model-version-id",
        default=os.environ.get("VITROFLOW_INFERENCE_MODEL_VERSION_ID"),
        help=(
            "Published model version served by this Worker "
            "(or VITROFLOW_INFERENCE_MODEL_VERSION_ID)"
        ),
    )
    parser.add_argument(
        "--worker-id",
        default=os.environ.get("VITROFLOW_INFERENCE_WORKER_ID") or socket.gethostname(),
        help=(
            "Identity shown on the workbench Status page "
            "(or VITROFLOW_INFERENCE_WORKER_ID)"
        ),
    )
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    parser.add_argument(
        "--health-port",
        type=int,
        default=os.environ.get("PORT"),
        help="Health endpoint port (or PORT)",
    )
    parser.add_argument("--config", help="JSON file overriding pipeline parameters")
    parser.add_argument("--model", help="Candidate model JSON")
    parser.add_argument(
        "--device",
        default=os.environ.get("VITROFLOW_INFERENCE_DEVICE"),
        help="Ultralytics inference device (or VITROFLOW_INFERENCE_DEVICE)",
    )
    parser.add_argument("--once", action="store_true", help="Run a single pass")
    return parser


def _deployment_manifest(args: argparse.Namespace) -> dict[str, Any]:
    response = httpx.get(
        f"{args.server.rstrip('/')}/api/inference/model-versions/{args.model_version_id}",
        headers={"Authorization": f"Bearer {args.token}"},
        timeout=120,
    )
    response.raise_for_status()
    manifest = response.json()
    if not isinstance(manifest, dict) or manifest.get("id") != args.model_version_id:
        raise ValueError("Server returned an invalid model version manifest")
    artifact = manifest.get("artifact")
    if not isinstance(artifact, dict) or artifact.get("kind") not in {
        "traditional",
        "ultralytics",
    }:
        raise ValueError("Model version has an unsupported artifact")
    return manifest


def _remote_yolo_run(args: argparse.Namespace, artifact: dict[str, Any]) -> Path:
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
    destination = args.work_dir / "model-artifacts" / args.model_version_id
    if destination.exists():
        cached = YoloPrelabeler.from_run(destination, device=args.device)
        if cached.artifact_digest != expected_digest:
            raise ValueError(
                "Cached YOLO artifact does not match the published version"
            )
        return destination

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{args.model_version_id}.", dir=destination.parent)
    )
    try:
        weights = temporary / "weights" / "best.pt"
        weights.parent.mkdir(parents=True)
        response = httpx.get(
            f"{args.server.rstrip('/')}/api/inference/model-versions/"
            f"{args.model_version_id}/weights",
            headers={"Authorization": f"Bearer {args.token}"},
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
        downloaded = YoloPrelabeler.from_run(temporary, device=args.device)
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


def _build_prelabeler(args: argparse.Namespace) -> Prelabeler:
    manifest = _deployment_manifest(args)
    artifact = manifest["artifact"]
    if artifact["kind"] == "ultralytics":
        if args.config or args.model:
            raise ValueError(
                "--config and --model only apply to traditional prelabelling"
            )
        run = _remote_yolo_run(args, artifact)
        prelabeler = YoloPrelabeler.from_run(run, device=args.device)
    else:
        if args.device:
            raise ValueError("--device only applies to YOLO prelabelling")
        config = (
            PipelineConfig.from_json(args.config) if args.config else PipelineConfig()
        )
        model = load_candidate_model(args.model) if args.model else DEFAULT_MODEL
        prelabeler = TraditionalPrelabeler(config, model)
    if prelabeler.artifact_digest != artifact.get("digest"):
        raise ValueError(
            "Local inference artifact does not match the published version"
        )
    return prelabeler


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.server:
        print("error: worker server URL is required", file=sys.stderr)
        return 2
    if not args.token:
        print("error: worker token is required", file=sys.stderr)
        return 2
    if not WORKER_ID.match(args.worker_id):
        print(
            "error: worker id must use letters, numbers, dots, dashes, or underscores",
            file=sys.stderr,
        )
        return 2
    if not args.model_version_id or not VERSION_ID.fullmatch(args.model_version_id):
        print("error: valid model version id is required", file=sys.stderr)
        return 2
    if args.poll_seconds <= 0:
        print("error: poll interval must be positive", file=sys.stderr)
        return 2
    if args.health_port is not None and not 1 <= args.health_port <= 65535:
        print("error: health port must be between 1 and 65535", file=sys.stderr)
        return 2

    try:
        args.work_dir.mkdir(parents=True, exist_ok=True)
        prelabeler = _build_prelabeler(args)
        identity = WorkerIdentity.create(
            args.worker_id,
            args.model_version_id,
            prelabeler,
        )
    except (OSError, TypeError, ValueError, RuntimeError, httpx.HTTPError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    client = WorkerClient(
        args.server,
        args.token,
        identity,
    )
    try:
        with health_server(args.health_port):
            while True:
                try:
                    processed = run_pass(client, args.work_dir, prelabeler)
                except WORKER_ERRORS as error:
                    print(f"worker error: {error}", file=sys.stderr, flush=True)
                    processed = False
                    if args.once:
                        return 1
                if args.once:
                    return 0
                if not processed:
                    time.sleep(args.poll_seconds)
    except KeyboardInterrupt:
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
