from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2
import httpx
import numpy as np
import pytest

from vitroflow.training_worker import (
    TrainingJob,
    TrainingLeaseLostError,
    TrainingWorkerClient,
    materialize_snapshot,
)


def _annotation(source: str, boxes: list[dict[str, float]]) -> dict[str, object]:
    return {
        "schemaVersion": 2,
        "image": {"path": source, "width": 100, "height": 80},
        "source": {
            "modelVersionId": "set.traditional-v1",
            "artifactDigest": "a" * 64,
            "runtime": {"adapter": "traditional", "fingerprint": "b" * 64},
        },
        "status": "complete",
        "revision": 1,
        "instances": [
            {"id": str(index), "class": "seed", "bbox": box}
            for index, box in enumerate(boxes)
        ],
    }


def test_training_client_uses_its_own_control_plane_contract(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []
    encoded, image_buffer = cv2.imencode(".jpg", np.zeros((80, 100, 3), dtype=np.uint8))
    assert encoded
    image = image_buffer.tobytes()
    snapshot = {
        "schemaVersion": 1,
        "id": "snapshot-one",
        "datasetId": "set",
        "modelId": "set",
        "createdAt": "2026-08-27T00:00:00.000Z",
        "images": [
            {
                "ref": {"dataset": "set", "stem": "a"},
                "source": "images/set/a.jpg",
                "artifactPath": "images/0.jpg",
                "imageDigest": hashlib.sha256(image).hexdigest(),
                "split": "train",
                "annotation": _annotation(
                    "images/set/a.jpg",
                    [{"x": 10, "y": 20, "width": 8, "height": 6}],
                ),
            },
            {
                "ref": {"dataset": "set", "stem": "b"},
                "source": "images/set/b.jpg",
                "artifactPath": "images/1.jpg",
                "imageDigest": hashlib.sha256(image).hexdigest(),
                "split": "val",
                "annotation": _annotation("images/set/b.jpg", []),
            },
        ],
    }
    run = {
        "schemaVersion": 1,
        "id": "train-one",
        "modelId": "set",
        "datasetSnapshotId": "snapshot-one",
        "createdAt": "2026-08-27T00:00:00.000Z",
        "attempt": 1,
        "recipe": {
            "baseModel": {"reference": "yolo26n.pt", "digest": "a" * 64},
            "configuration": {"name": "seed-small.yaml", "digest": "b" * 64},
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
        if request.url.path.startswith("/api/training/runs/train-one/images/"):
            return httpx.Response(200, content=image)
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
        "/api/training/runs/train-one/images/0",
        "/api/training/runs/train-one/images/1",
    ]
    train_image = next((tmp_path / "dataset/images/train").iterdir())
    train_label = next((tmp_path / "dataset/labels/train").iterdir())
    val_label = next((tmp_path / "dataset/labels/val").iterdir())
    assert train_image.read_bytes() == image
    assert train_label.read_text().strip() == (
        "0 0.14000000 0.28750000 0.08000000 0.07500000"
    )
    assert val_label.read_text() == ""
    assert dataset_yaml.read_text() == (
        "train: images/train\nval: images/val\nnames:\n  0: seed\n"
    )


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
            client.image("train-one", 0, "a" * 64)
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
            client.progress("train-one", "training", 0.5)
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
