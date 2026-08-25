from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import httpx

from .artifacts import create_image_artifacts

WORKER_ERRORS = (OSError, ValueError, RuntimeError, cv2.error, httpx.HTTPError)


@dataclass(frozen=True)
class WorkerImage:
    image_id: str
    source: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkerImage:
        image_id = data.get("id")
        source = data.get("source")
        if not isinstance(image_id, str) or not image_id:
            raise ValueError("Job image is missing an id")
        if not isinstance(source, str) or not source:
            raise ValueError("Job image is missing a source")
        return cls(image_id, source)


@dataclass(frozen=True)
class WorkerJob:
    job_id: str
    run_id: str
    images: tuple[WorkerImage, ...]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkerJob:
        job_id = data.get("id")
        run_id = data.get("runId")
        raw_images = data.get("images")
        if not isinstance(job_id, str) or not job_id:
            raise ValueError("Job is missing an id")
        if not isinstance(run_id, str) or not run_id:
            raise ValueError("Job is missing a run id")
        if not isinstance(raw_images, list) or not raw_images:
            raise ValueError("Job has no images")
        return cls(
            job_id,
            run_id,
            tuple(WorkerImage.from_dict(item) for item in raw_images),
        )


class WorkerClient:
    def __init__(
        self,
        server_url: str,
        token: str,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
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

    def claim(self) -> WorkerJob | None:
        response = self._request("POST", "api/worker/jobs/claim")
        if response.status_code == 204:
            return None
        response.raise_for_status()
        return WorkerJob.from_dict(response.json())

    def download(self, job: WorkerJob, image: WorkerImage) -> bytes:
        response = self._request(
            "GET",
            f"api/worker/jobs/{job.job_id}/images/{image.image_id}"
        )
        response.raise_for_status()
        return response.content

    def upload(
        self,
        job: WorkerJob,
        image: WorkerImage,
        result_json: bytes,
        overlay_jpeg: bytes,
        debug_jpeg: bytes,
    ) -> None:
        response = self._request(
            "PUT",
            f"api/worker/jobs/{job.job_id}/results/{image.image_id}",
            files={
                "result": ("result.json", result_json, "application/json"),
                "overlay": ("overlay.jpg", overlay_jpeg, "image/jpeg"),
                "debug": ("debug.jpg", debug_jpeg, "image/jpeg"),
            },
        )
        response.raise_for_status()

    def complete(self, job: WorkerJob) -> None:
        response = self._request("POST", f"api/worker/jobs/{job.job_id}/complete")
        response.raise_for_status()

    def fail(self, job: WorkerJob, error: str) -> None:
        response = self._request(
            "POST",
            f"api/worker/jobs/{job.job_id}/fail",
            json={"error": error[:2000]},
        )
        response.raise_for_status()


def process_job(client: WorkerClient, job: WorkerJob, work_dir: Path) -> None:
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        for image in job.images:
            suffix = Path(image.source).suffix.lower() or ".jpg"
            image_path = work_dir / f"{image.image_id}{suffix}"
            image_path.write_bytes(client.download(job, image))
            artifacts = create_image_artifacts(image_path, image.source)
            client.upload(
                job,
                image,
                artifacts.result_json,
                artifacts.overlay_jpeg,
                artifacts.debug_jpeg,
            )
        client.complete(job)
    except Exception as error:
        try:
            client.fail(job, str(error))
        except WORKER_ERRORS as report_error:
            print(f"unable to report failed job {job.job_id}: {report_error}", file=sys.stderr)
        raise


def run_once(client: WorkerClient, work_root: Path) -> bool:
    job = client.claim()
    if job is None:
        return False
    print(f"claimed {job.run_id} ({len(job.images)} images)", flush=True)
    with tempfile.TemporaryDirectory(prefix=f"vitroflow-{job.job_id}-", dir=work_root) as temporary:
        process_job(client, job, Path(temporary))
    print(f"completed {job.run_id}", flush=True)
    return True


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vitroflow-worker",
        description="Process recognition jobs from a VitroFlow workbench.",
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
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    parser.add_argument("--once", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.server:
        print("error: worker server URL is required", file=sys.stderr)
        return 2
    if not args.token:
        print("error: worker token is required", file=sys.stderr)
        return 2
    if args.poll_seconds <= 0:
        print("error: poll interval must be positive", file=sys.stderr)
        return 2

    args.work_dir.mkdir(parents=True, exist_ok=True)
    client = WorkerClient(args.server, args.token)
    try:
        while True:
            try:
                processed = run_once(client, args.work_dir)
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
