from __future__ import annotations

import json
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from conftest import annotation_document, encoded_image, write_blob

from vitroflow import training_worker
from vitroflow.training_worker import (
    TrainingJob,
    TrainingLeaseLostError,
    TrainingWorkerClient,
    materialize_snapshot,
    parse_training_snapshot,
)
from vitroflow.yolo import EpochReport, YoloTrainingInterruptedError

PARAMETERS = {
    "epochs": 3,
    "patience": 20,
    "batch": 4,
    "imgsz": 768,
    "optimizer": "AdamW",
    "lr0": 0.001,
    "warmup_epochs": 3.0,
    "mosaic": 0.0,
    "mixup": 0.0,
    "copy_paste": 0.0,
    "max_det": 500,
    "seed": 0,
    "deterministic": True,
}


def _parameters(**overrides: object) -> dict[str, object]:
    return {**PARAMETERS, **overrides}


def _snapshot(images: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "id": "snapshot-one",
        "datasetId": "set",
        "modelId": "set",
        "createdAt": "2026-08-27T00:00:00.000Z",
        "images": images,
    }


def _snapshot_image(
    digest: str, split: str, boxes: list[dict[str, float]]
) -> dict[str, object]:
    return {
        "digest": digest,
        "extension": ".jpg",
        "split": split,
        "annotation": annotation_document(digest, boxes),
    }


def test_training_client_uses_its_own_control_plane_contract(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []
    images = {}
    for variant in range(2):
        pixels = encoded_image(variant=variant)
        images[write_blob(tmp_path / "unused", pixels)] = pixels
    train_digest, val_digest = images
    snapshot = _snapshot(
        [
            _snapshot_image(
                train_digest, "train", [{"x": 10, "y": 20, "width": 8, "height": 6}]
            ),
            _snapshot_image(val_digest, "val", []),
        ]
    )
    run = {
        "schemaVersion": 1,
        "id": "train-one",
        "modelId": "set",
        "datasetSnapshotId": "snapshot-one",
        "createdAt": "2026-08-27T00:00:00.000Z",
        "attempt": 1,
        "recipe": {
            "baseModel": {"reference": "yolo26n.pt", "digest": "a" * 64},
            "parameters": PARAMETERS,
            "runtime": {"framework": "ultralytics", "version": "8.4.129"},
        },
        "state": {"status": "running"},
    }

    def server(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer training-secret"
        if request.url.path == "/api/training/heartbeat":
            return httpx.Response(200, json={})
        if request.url.path == "/api/training/claim":
            return httpx.Response(200, json={"run": run})
        if request.url.path == "/api/training/runs/train-one/snapshot":
            return httpx.Response(200, json=snapshot)
        digest = request.url.path.removeprefix("/api/training/runs/train-one/images/")
        if digest in images:
            return httpx.Response(200, content=images[digest])
        return httpx.Response(404)

    client = TrainingWorkerClient(
        "https://example.test",
        "training-secret",
        "trainer",
        "2026-08-27T00:00:00.000Z",
        "cuda:0",
        transport=httpx.MockTransport(server),
    )
    try:
        client.heartbeat()
        job = client.claim()
        assert job is not None
        dataset_yaml = materialize_snapshot(client, job, tmp_path / "dataset")
    finally:
        client.close()

    assert [request.url.path for request in requests] == [
        "/api/training/heartbeat",
        "/api/training/claim",
        "/api/training/runs/train-one/snapshot",
        f"/api/training/runs/train-one/images/{train_digest}",
        f"/api/training/runs/train-one/images/{val_digest}",
    ]
    train_image = next((tmp_path / "dataset/images/train").iterdir())
    train_label = next((tmp_path / "dataset/labels/train").iterdir())
    val_label = next((tmp_path / "dataset/labels/val").iterdir())
    assert train_image.name == f"{train_digest}.jpg"
    assert train_label.name == f"{train_digest}.txt"
    assert val_label.name == f"{val_digest}.txt"
    assert train_image.read_bytes() == images[train_digest]
    assert train_label.read_text().strip() == (
        "0 0.14000000 0.28750000 0.08000000 0.07500000"
    )
    assert val_label.read_text() == ""
    assert dataset_yaml.read_text() == (
        "train: images/train\nval: images/val\nnames:\n  0: seed\n"
    )


def test_snapshot_parser_validates_every_image_entry() -> None:
    snapshot = parse_training_snapshot(
        _snapshot([_snapshot_image("1" * 64, "val", [])])
    )
    assert snapshot.id == "snapshot-one"
    assert snapshot.images[0].split == "val"
    assert snapshot.images[0].annotation.digest == "1" * 64

    with pytest.raises(ValueError, match="snapshot.schemaVersion must be 1"):
        parse_training_snapshot({**_snapshot([]), "schemaVersion": 99})
    with pytest.raises(ValueError, match=r"images\[0\].split must be train or val"):
        parse_training_snapshot(_snapshot([_snapshot_image("1" * 64, "test", [])]))
    with pytest.raises(ValueError, match=r"images\[0\].annotation describes another"):
        parse_training_snapshot(
            _snapshot([{**_snapshot_image("1" * 64, "val", []), "digest": "2" * 64}])
        )
    incomplete = _snapshot_image("1" * 64, "val", [])
    incomplete["annotation"] = annotation_document("1" * 64, status="in_progress")
    with pytest.raises(ValueError, match=r"images\[0\].annotation is not complete"):
        parse_training_snapshot(_snapshot([incomplete]))


def test_training_client_rejects_snapshot_image_corruption() -> None:
    client = TrainingWorkerClient(
        "https://example.test",
        "secret",
        "trainer",
        "2026-08-27T00:00:00.000Z",
        "cpu",
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"bad")),
    )
    try:
        with pytest.raises(ValueError, match="digest verification"):
            client.download_image("train-one", "a" * 64)
    finally:
        client.close()


def test_training_client_surfaces_lease_loss() -> None:
    client = TrainingWorkerClient(
        "https://example.test",
        "secret",
        "trainer",
        "2026-08-27T00:00:00.000Z",
        "cpu",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(409, text="lease expired")
        ),
    )
    try:
        with pytest.raises(TrainingLeaseLostError, match="lease expired"):
            client.renew_lease("train-one")
    finally:
        client.close()


def test_claim_response_requires_a_run_object() -> None:
    client = TrainingWorkerClient(
        "https://example.test",
        "secret",
        "trainer",
        "2026-08-27T00:00:00.000Z",
        "cpu",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, content=json.dumps({"run": []}))
        ),
    )
    try:
        with pytest.raises(TypeError, match="claim response"):
            client.claim()
    finally:
        client.close()


def test_training_job_exposes_run_identity() -> None:
    assert TrainingJob({"id": "train-one"}).run_id == "train-one"


def test_snapshot_materialization_honors_shutdown_before_network_access(
    tmp_path: Path,
) -> None:
    class UnexpectedClient:
        def fetch_snapshot(self, _run_id: str) -> None:
            pytest.fail("cancelled materialization must not request a snapshot")

    with pytest.raises(YoloTrainingInterruptedError, match="interrupted"):
        materialize_snapshot(
            UnexpectedClient(),  # type: ignore[arg-type]
            TrainingJob({"id": "train-one"}),
            tmp_path / "dataset",
            cancelled=lambda: True,
        )


def test_lease_refresh_failure_cancels_training_and_surfaces_lease_loss(
    monkeypatch,
) -> None:
    class FailingClient:
        renew_calls = 0

        def renew_lease(self, _run_id: str) -> None:
            self.renew_calls += 1
            if self.renew_calls > 1:
                raise OSError("connection lost")

        def heartbeat(self) -> None:
            return None

    monkeypatch.setattr(training_worker, "LEASE_REFRESH_SECONDS", 0.001)
    deadline = time.monotonic() + 1

    with (
        pytest.raises(TrainingLeaseLostError, match="refresh failed"),
        training_worker._lease(
            FailingClient(),  # type: ignore[arg-type]
            "train-one",
        ) as cancelled,
    ):
        while not cancelled() and time.monotonic() < deadline:
            time.sleep(0.001)
        assert cancelled()
        raise YoloTrainingInterruptedError("training interrupted")


def test_training_job_reports_each_epoch_and_publishes_the_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    posted: list[tuple[str, dict[str, object]]] = []
    artifacts: list[tuple[str, bytes, dict[str, object]]] = []

    class Client:
        worker_id = "trainer"
        device = "mps"
        current_run_id: str | None = None

        def heartbeat(self) -> None:
            return None

        def enter_phase(self, run_id: str, phase: str) -> None:
            posted.append((run_id, {"phase": phase}))

        def renew_lease(self, run_id: str) -> None:
            posted.append((run_id, {"lease": "renewed"}))

        def report_epoch(self, run_id: str, report: EpochReport) -> None:
            posted.append((run_id, report.to_json()))

        def publish_artifact(
            self, run_id: str, weights: Path, inference: Path
        ) -> None:
            artifacts.append(
                (run_id, weights.read_bytes(), json.loads(inference.read_text()))
            )

        def report_failure(self, run_id: str, error: str) -> None:
            pytest.fail(f"unexpected failure report: {error}")

    def materialize(_client, _job, output: Path, *, cancelled=None) -> Path:
        output.mkdir(parents=True)
        dataset = output / "dataset.yaml"
        dataset.write_text("train: images/train\nval: images/val\n")
        return dataset

    def train(
        dataset,
        output_dir,
        *,
        parameters,
        on_training_start,
        on_epoch,
        on_validation_start,
        **options,
    ):
        assert parameters == _parameters(epochs=2)
        assert options["model"] == "yolo26n.pt"
        assert options["model_digest"] == "a" * 64
        assert options["runtime_version"] == "8.4.129"
        assert options["device"] == "mps"
        output = Path(output_dir)
        (output / "weights").mkdir(parents=True)
        (output / "weights" / "best.pt").write_bytes(b"weights")
        summary = output / "inference.json"
        summary.write_text(json.dumps({"schema_version": 1}))
        on_training_start()
        for epoch in (1, 2):
            on_epoch(
                EpochReport(
                    epoch=epoch,
                    train={"box": 1.0, "cls": 2.0, "dfl": 0.5},
                    val={"box": 1.1, "cls": 2.1, "dfl": 0.6},
                    precision=0.5,
                    recall=0.4,
                    map50=0.45,
                    map5095=0.2,
                    fitness=0.225,
                    lr=0.001,
                )
            )
        on_validation_start()
        return SimpleNamespace(
            best_weights=output / "weights" / "best.pt",
            summary=summary,
            metrics={},
            confidence=0.3,
        )

    monkeypatch.setattr(training_worker, "materialize_snapshot", materialize)
    monkeypatch.setattr(training_worker, "train_yolo_detector", train)
    job = TrainingJob(
        {
            "id": "train-one",
            "recipe": {
                "baseModel": {"reference": "yolo26n.pt", "digest": "a" * 64},
                "parameters": _parameters(epochs=2),
                "runtime": {"framework": "ultralytics", "version": "8.4.129"},
            },
        }
    )

    training_worker.process_training_job(Client(), job, tmp_path)  # type: ignore[arg-type]

    assert [entry["phase"] for _, entry in posted if "phase" in entry] == [
        "preparing",
        "training",
        "validating",
    ]
    assert [entry["epoch"] for _, entry in posted if "epoch" in entry] == [1, 2]
    assert [entry["lease"] for _, entry in posted if "lease" in entry] == [
        "renewed"
    ]
    assert artifacts == [("train-one", b"weights", {"schema_version": 1})]
