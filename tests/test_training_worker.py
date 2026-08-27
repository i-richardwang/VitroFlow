from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from conftest import annotation_document, encoded_image, write_blob

from vitroflow.training_worker import (
    TrainingJob,
    TrainingLeaseLostError,
    TrainingWorkerClient,
    materialize_snapshot,
    parse_training_snapshot,
)


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
            client.image("train-one", "a" * 64)
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
