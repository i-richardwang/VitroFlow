from __future__ import annotations

import logging
import os
import shutil
import threading
import time
from collections.abc import Callable
from pathlib import Path

from vitroctl.contracts.documents import as_object, expect_fields
from vitroctl.detectors.ultralytics import (
    DatasetImage,
    EpochReport,
    YoloTrainingInterruptedError,
    export_dataset_images,
    train_yolo_detector,
)
from vitroctl.io.image_io import CANONICAL_EXTENSION, image_digest, verify_digest
from vitroctl.training.documents import (
    TrainingJob,
    TrainingPhase,
    TrainingSnapshot,
    parse_training_snapshot,
)
from vitroctl.worker.session import LeaseLostError, WorkerClient, keep_lease

LOGGER = logging.getLogger(__name__)

# A run keeps its directory until it ends, so an interrupted run that this
# machine claims again resumes from what it left there.
RUNS_DIRECTORY = "training-runs"
STALE_RUN_SECONDS = 7 * 24 * 60 * 60


class TrainingArtifactRejectedError(RuntimeError):
    pass


class TrainingClient:
    """The training protocol: claim a run, feed it, report on it, publish it."""

    def __init__(self, worker: WorkerClient) -> None:
        self.worker = worker

    @property
    def identity(self) -> dict[str, str]:
        return self.worker.identity

    def claim(self) -> TrainingJob | None:
        response = self.worker.request(
            "POST",
            "api/worker/training/claim",
            json=self.identity,
        )
        response.raise_for_status()
        document = as_object(response.json(), "training claim response")
        expect_fields(document, {"run"}, "training claim response")
        if document["run"] is None:
            return None
        job = TrainingJob.parse(document["run"])
        if job.session_id != self.worker.session.session_id:
            raise ValueError("Training claim returned another session's lease")
        return job

    def fetch_snapshot(self, run_id: str) -> TrainingSnapshot:
        response = self.worker.request(
            "GET",
            f"api/worker/training/runs/{run_id}/snapshot",
            params=self.identity,
        )
        self.worker.require_current_session(response)
        return parse_training_snapshot(response.json())

    def enter_phase(self, run_id: str, phase: TrainingPhase) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/training/runs/{run_id}/phase",
            json={
                **self.identity,
                "phase": phase,
            },
        )
        self.worker.require_current_session(response)

    def renew_lease(self, run_id: str) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/training/runs/{run_id}/lease",
            json=self.identity,
        )
        self.worker.require_current_session(response)

    def report_epoch(self, run_id: str, report: EpochReport) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/training/runs/{run_id}/epochs",
            json={**self.identity, **report.to_json()},
        )
        self.worker.require_current_session(response)

    def download_image(self, run_id: str, digest: str) -> bytes:
        response = self.worker.request(
            "GET",
            f"api/worker/training/runs/{run_id}/images/{digest}",
            params=self.identity,
        )
        self.worker.require_current_session(response)
        return verify_digest(response.content, digest)

    def publish_artifact(self, run_id: str, weights: Path, inference: Path) -> None:
        response = self.worker.request(
            "PUT",
            f"api/worker/training/runs/{run_id}/artifact",
            data=self.identity,
            files={
                "weights": ("best.pt", weights.read_bytes()),
                "inference": (
                    "inference.json",
                    inference.read_bytes(),
                    "application/json",
                ),
            },
            timeout=None,
        )
        if response.status_code in {400, 422}:
            raise TrainingArtifactRejectedError(response.text)
        self.worker.require_current_session(response)

    def report_failure(self, run_id: str, error: str) -> None:
        response = self.worker.request(
            "POST",
            f"api/worker/training/runs/{run_id}/fail",
            json={**self.identity, "error": error[:2000]},
        )
        if response.status_code == 409:
            return
        response.raise_for_status()


def materialize_snapshot(
    client: TrainingClient,
    job: TrainingJob,
    output: Path,
    *,
    cancelled: Callable[[], bool] | None = None,
) -> Path:
    if cancelled and cancelled():
        raise YoloTrainingInterruptedError("training interrupted")
    dataset = output / "dataset.yaml"
    if dataset.is_file():
        # The export publishes atomically, so a dataset that exists is complete.
        return dataset
    snapshot = client.fetch_snapshot(job.run_id)
    if len(snapshot.images) < 2:
        raise ValueError("Training snapshot must contain at least two images")
    downloads = output.parent / "snapshot-images"
    downloads.mkdir(parents=True, exist_ok=True)
    dataset_images: list[DatasetImage] = []
    for image in snapshot.images:
        if cancelled and cancelled():
            raise YoloTrainingInterruptedError("training interrupted")
        downloaded = downloads / f"{image.digest}{CANONICAL_EXTENSION}"
        if not downloaded.is_file() or image_digest(downloaded) != image.digest:
            downloaded.write_bytes(client.download_image(job.run_id, image.digest))
        dataset_images.append(
            DatasetImage(
                digest=image.digest,
                width=image.annotation.width,
                height=image.annotation.height,
                instances=image.annotation.instances,
                split=image.split,
                file_path=downloaded,
            )
        )
    export_dataset_images(dataset_images, snapshot.classes, output.parent, output)
    shutil.rmtree(downloads)
    return dataset


def _prune_stale_runs(runs: Path) -> None:
    """Drop run directories no claim has touched for a week; those runs moved on."""
    if not runs.is_dir():
        return
    horizon = time.time() - STALE_RUN_SECONDS
    for directory in runs.iterdir():
        if directory.is_dir() and directory.stat().st_mtime < horizon:
            shutil.rmtree(directory, ignore_errors=True)


def process_training_job(
    client: TrainingClient,
    job: TrainingJob,
    work_root: Path,
    device: str | None,
    stopped: threading.Event | None = None,
) -> None:
    def ensure_running() -> None:
        if stopped and stopped.is_set():
            raise YoloTrainingInterruptedError("training interrupted")

    runs = work_root / RUNS_DIRECTORY
    _prune_stale_runs(runs)
    root = runs / job.run_id
    root.mkdir(parents=True, exist_ok=True)
    os.utime(root)  # a run ages from its latest claim
    try:
        recipe = job.recipe
        with keep_lease(
            client.worker,
            lambda: client.renew_lease(job.run_id),
            cancelled=stopped.is_set if stopped else None,
        ) as cancelled:
            client.enter_phase(job.run_id, "preparing")
            dataset = materialize_snapshot(
                client,
                job,
                root / "dataset",
                cancelled=cancelled,
            )
            result = train_yolo_detector(
                dataset,
                root / "run",
                parameters=recipe.parameters,
                model=recipe.base_model_reference,
                model_digest=recipe.base_model_digest,
                runtime_version=recipe.runtime_version,
                device=device,
                cancelled=cancelled,
                on_training_start=lambda: client.enter_phase(job.run_id, "training"),
                on_epoch=lambda epoch: client.report_epoch(job.run_id, epoch),
                on_validation_start=lambda: client.enter_phase(
                    job.run_id, "validating"
                ),
            )
        ensure_running()
        if result.confidence is None:
            raise RuntimeError("Training completed without a usable validation signal")
        client.publish_artifact(job.run_id, result.best_weights, result.summary)
    except (YoloTrainingInterruptedError, LeaseLostError):
        # An interruption is no outcome: the directory stays for the next claim.
        raise
    except Exception as error:
        try:
            client.report_failure(job.run_id, str(error) or type(error).__name__)
        except Exception:
            LOGGER.exception("failed to report training run failure")
        shutil.rmtree(root, ignore_errors=True)
        raise
    shutil.rmtree(root, ignore_errors=True)
