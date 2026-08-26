from __future__ import annotations

import argparse
import os
import re
import socket
import sys
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import cv2
import httpx

from .config import PipelineConfig
from .prelabelers import Prelabeler, PrelabelerDescriptor, TraditionalPrelabeler
from .scoring import DEFAULT_MODEL, load_candidate_model

WORKER_ERRORS = (OSError, ValueError, RuntimeError, cv2.error, httpx.HTTPError)
DETECTION_ERRORS = (OSError, ValueError, RuntimeError, cv2.error)
WORKER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
_ERROR_MESSAGE_LIMIT = 2000


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/healthz":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = b"ok\n"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


@contextmanager
def _health_server(port: int | None) -> Iterator[int | None]:
    if port is None:
        yield None
        return
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    thread = threading.Thread(
        target=server.serve_forever,
        name="vitroflow-health",
        daemon=True,
    )
    thread.start()
    try:
        yield server.server_port
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


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
    """What a worker process reports about itself on every heartbeat."""

    worker_id: str
    started_at: str
    prelabeler: PrelabelerDescriptor

    @classmethod
    def create(cls, worker_id: str, prelabeler: Prelabeler) -> WorkerIdentity:
        return cls(
            worker_id,
            datetime.now(UTC).isoformat(),
            prelabeler.descriptor,
        )

    def heartbeat(self, current: PendingImage | None) -> dict[str, object]:
        return {
            "workerId": self.worker_id,
            "startedAt": self.started_at,
            "prelabeler": self.prelabeler.to_dict(),
            "current": current.to_dict() if current else None,
        }

    def failure(self, image: PendingImage, error: Exception) -> dict[str, object]:
        """The prelabel document recorded when detection cannot produce a result."""
        return {
            "source": image.source,
            "error": str(error)[:_ERROR_MESSAGE_LIMIT],
            "schema_version": 1,
            "producer": self.prelabeler.to_dict(),
        }


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
            "POST", "api/worker/heartbeat", json=self.identity.heartbeat(current)
        )
        response.raise_for_status()

    def pending(self) -> tuple[PendingImage, ...]:
        prelabeler = self.identity.prelabeler
        response = self._request(
            "GET",
            "api/worker/pending",
            params={
                "version_id": prelabeler.version_id,
                "fingerprint": prelabeler.fingerprint,
            },
        )
        response.raise_for_status()
        images = response.json().get("images")
        if not isinstance(images, list):
            raise TypeError("Pending response must contain an images array")
        return tuple(PendingImage.from_dict(item) for item in images)

    def download(self, image: PendingImage) -> bytes:
        response = self._request(
            "GET", f"api/worker/images/{image.dataset}/{image.stem}"
        )
        response.raise_for_status()
        return response.content

    def put_prelabel(self, image: PendingImage, document: dict[str, object]) -> bool:
        """Store a prelabel; returns False when a label already owns the image."""
        response = self._request(
            "PUT",
            f"api/worker/prelabels/{image.dataset}/{image.stem}",
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
        result = prelabeler.predict(image_path, Path(image.source))
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
        prog="vitroflow-worker",
        description="Prelabel pending images of a VitroFlow workbench.",
    )
    parser.add_argument(
        "--server",
        default=os.environ.get("VITROFLOW_SERVER_URL"),
        help="Workbench base URL (or VITROFLOW_SERVER_URL)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("VITROFLOW_WORKER_TOKEN"),
        help="Worker bearer token (or VITROFLOW_WORKER_TOKEN)",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path(os.environ.get("VITROFLOW_WORK_DIR", tempfile.gettempdir())),
    )
    parser.add_argument(
        "--worker-id",
        default=os.environ.get("VITROFLOW_WORKER_ID") or socket.gethostname(),
        help="Identity shown on the workbench Status page (or VITROFLOW_WORKER_ID)",
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
    parser.add_argument("--once", action="store_true", help="Run a single pass")
    return parser


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
    if args.poll_seconds <= 0:
        print("error: poll interval must be positive", file=sys.stderr)
        return 2
    if args.health_port is not None and not 1 <= args.health_port <= 65535:
        print("error: health port must be between 1 and 65535", file=sys.stderr)
        return 2

    try:
        args.work_dir.mkdir(parents=True, exist_ok=True)
        config = (
            PipelineConfig.from_json(args.config) if args.config else PipelineConfig()
        )
        model = load_candidate_model(args.model) if args.model else DEFAULT_MODEL
        prelabeler = TraditionalPrelabeler(config, model)
    except (OSError, TypeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    client = WorkerClient(
        args.server,
        args.token,
        WorkerIdentity.create(args.worker_id, prelabeler),
    )
    try:
        with _health_server(args.health_port):
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
