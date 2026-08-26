from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from vitroflow.config import PipelineConfig
from vitroflow.scoring import DEFAULT_MODEL
from vitroflow.worker import (
    WorkerClient,
    WorkerIdentity,
    WorkerImage,
    WorkerJob,
    _health_server,
    process_job,
)

IDENTITY = WorkerIdentity.create("test-worker", PipelineConfig(), DEFAULT_MODEL)


class FakeClient:
    def __init__(self, *, fail_download: bool = False) -> None:
        self.fail_download = fail_download
        self.uploads: list[tuple[str, bytes, bytes, bytes]] = []
        self.heartbeats: list[str | None] = []
        self.completed = False
        self.failure: str | None = None

    def heartbeat(self, job: WorkerJob | None) -> None:
        self.heartbeats.append(job.job_id if job else None)

    def download(self, job: WorkerJob, image: WorkerImage) -> bytes:
        if self.fail_download:
            raise OSError("download failed")
        return b"source"

    def upload(
        self,
        job: WorkerJob,
        image: WorkerImage,
        result_json: bytes,
        overlay_jpeg: bytes,
        debug_jpeg: bytes,
    ) -> None:
        self.uploads.append((image.image_id, result_json, overlay_jpeg, debug_jpeg))

    def complete(self, job: WorkerJob) -> None:
        self.completed = True

    def fail(self, job: WorkerJob, error: str) -> None:
        self.failure = error


def test_health_server_reports_liveness() -> None:
    with _health_server(0) as port:
        response = httpx.get(f"http://127.0.0.1:{port}/healthz")
        missing = httpx.get(f"http://127.0.0.1:{port}/missing")

    assert response.status_code == 200
    assert response.text == "ok\n"
    assert missing.status_code == 404


def test_worker_job_validates_the_claim_payload() -> None:
    job = WorkerJob.from_dict(
        {
            "id": "job",
            "runId": "run",
            "images": [{"id": "image", "source": "images/set/a.jpg"}],
            "completedImageIds": [],
        }
    )

    assert job.run_id == "run"
    assert job.images == (WorkerImage("image", "images/set/a.jpg"),)
    assert job.pending_images() == job.images
    with pytest.raises(ValueError, match="no images"):
        WorkerJob.from_dict(
            {"id": "job", "runId": "run", "images": [], "completedImageIds": []}
        )
    with pytest.raises(ValueError, match="completed image ids"):
        WorkerJob.from_dict(
            {
                "id": "job",
                "runId": "run",
                "images": [{"id": "image", "source": "images/set/a.jpg"}],
            }
        )


def test_worker_job_skips_images_the_workbench_already_holds() -> None:
    job = WorkerJob.from_dict(
        {
            "id": "job",
            "runId": "run",
            "images": [
                {"id": "done", "source": "images/set/a.jpg"},
                {"id": "todo", "source": "images/set/b.jpg"},
            ],
            "completedImageIds": ["done"],
        }
    )

    assert job.pending_images() == (WorkerImage("todo", "images/set/b.jpg"),)


def test_worker_identity_reports_a_stable_execution() -> None:
    heartbeat = IDENTITY.heartbeat("job")

    assert heartbeat["workerId"] == "test-worker"
    assert heartbeat["currentJobId"] == "job"
    execution = heartbeat["execution"]
    assert isinstance(execution, dict)
    assert execution["model"] == {
        "name": DEFAULT_MODEL.name,
        "fingerprint": DEFAULT_MODEL.fingerprint,
    }
    assert execution["config"] == PipelineConfig().to_dict()
    assert IDENTITY.heartbeat(None)["currentJobId"] is None


def test_worker_client_uses_the_authenticated_http_contract() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer secret"
        path = request.url.path
        if path == "/api/worker/heartbeat":
            assert json.loads(request.read()) == IDENTITY.heartbeat(None)
            return httpx.Response(200, json={})
        if path == "/api/worker/jobs/claim":
            assert request.read() == b'{"workerId":"test-worker"}'
            return httpx.Response(
                200,
                json={
                    "id": "job",
                    "runId": "run",
                    "images": [{"id": "image", "source": "images/set/a.jpg"}],
                    "completedImageIds": [],
                },
            )
        if path.endswith("/images/image"):
            return httpx.Response(200, content=b"source")
        return httpx.Response(200, json={})

    client = WorkerClient(
        "https://example.test",
        "secret",
        IDENTITY,
        transport=httpx.MockTransport(handle),
    )
    try:
        client.heartbeat(None)
        job = client.claim()
        assert job is not None
        image = job.images[0]
        assert client.download(job, image) == b"source"
        client.upload(job, image, b"result", b"overlay", b"debug")
        client.complete(job)
        client.fail(job, "failure")
    finally:
        client.close()

    assert [request.method for request in requests] == [
        "POST",
        "POST",
        "GET",
        "PUT",
        "POST",
        "POST",
    ]
    upload = requests[3]
    assert upload.url.path == "/api/worker/jobs/job/results/image"
    body = upload.read()
    assert b'name="result"' in body
    assert b'name="overlay"' in body
    assert b'name="debug"' in body


def test_process_job_uploads_artifacts_and_completes(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        "vitroflow.worker.create_image_artifacts",
        lambda path, source, *, config, model: SimpleNamespace(
            result_json=b"result",
            overlay_jpeg=b"overlay",
            debug_jpeg=b"debug",
        ),
    )
    client = FakeClient()
    job = WorkerJob(
        "job",
        "run",
        (WorkerImage("image", "images/set/a.jpg"),),
        frozenset(),
    )

    process_job(client, job, tmp_path, PipelineConfig(), DEFAULT_MODEL)

    assert client.uploads == [("image", b"result", b"overlay", b"debug")]
    assert client.heartbeats == ["job"]
    assert client.completed is True
    assert client.failure is None


def test_process_job_reports_failure(tmp_path) -> None:
    client = FakeClient(fail_download=True)
    job = WorkerJob(
        "job",
        "run",
        (WorkerImage("image", "images/set/a.jpg"),),
        frozenset(),
    )

    with pytest.raises(OSError, match="download failed"):
        process_job(client, job, tmp_path, PipelineConfig(), DEFAULT_MODEL)

    assert client.completed is False
    assert client.failure == "download failed"
