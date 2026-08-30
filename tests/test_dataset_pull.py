import hashlib
import json
from pathlib import Path

import httpx
import pytest
from conftest import annotation_document, manifest_document, manifest_entry

from vitroflow.annotations import load_annotations
from vitroflow.dataset_pull import DatasetPullError, PullReport, pull_dataset
from vitroflow.manifest import BlobError, blob_path, verified_blob

IMAGE_A = b"photograph a"
IMAGE_B = b"photograph b"
DIGEST_A = hashlib.sha256(IMAGE_A).hexdigest()
DIGEST_B = hashlib.sha256(IMAGE_B).hexdigest()


def _export() -> dict[str, object]:
    return manifest_document(
        "seeds",
        [
            manifest_entry(
                DIGEST_A,
                size=len(IMAGE_A),
                split="train",
                detection={"schema_version": 1, "note": "opaque"},
                label=annotation_document(DIGEST_A, width=100, height=100),
            ),
            manifest_entry(DIGEST_B, size=len(IMAGE_B)),
        ],
    )


def _server(
    *,
    blobs: dict[str, bytes] | None = None,
    export: dict[str, object] | None = None,
):
    served = {DIGEST_A: IMAGE_A, DIGEST_B: IMAGE_B} if blobs is None else blobs
    document = _export() if export is None else export
    requests: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        assert request.headers["Authorization"] == "Bearer secret"
        if request.url.path == "/api/export/datasets/seeds":
            return httpx.Response(200, json=document)
        digest = request.url.path.removeprefix("/api/export/images/")
        if digest in served:
            return httpx.Response(200, content=served[digest])
        return httpx.Response(404)

    return handle, requests


def _pull(root: Path, handle) -> PullReport:
    return pull_dataset(
        "https://workbench.example",
        "secret",
        "seeds",
        root,
        transport=httpx.MockTransport(handle),
    )


def test_pull_materializes_blobs_and_the_manifest(tmp_path: Path) -> None:
    handle, requests = _server()
    root = tmp_path / "data"

    report = _pull(root, handle)

    assert report == PullReport("seeds", kept=0, downloaded=2, replaced=0)
    assert report.images == 2
    assert blob_path(root, DIGEST_A).read_bytes() == IMAGE_A
    assert blob_path(root, DIGEST_B).read_bytes() == IMAGE_B
    manifest = root / "datasets" / "seeds.json"
    assert json.loads(manifest.read_text()) == _export()
    assert requests == [
        "/api/export/datasets/seeds",
        f"/api/export/images/{DIGEST_A}",
        f"/api/export/images/{DIGEST_B}",
    ]
    assert sorted(child.name for child in root.iterdir()) == ["blobs", "datasets"]
    labelled = load_annotations(manifest)
    assert [image.entry.digest for image in labelled] == [DIGEST_A]
    assert labelled[0].entry.split == "train"
    assert verified_blob(root, DIGEST_A) == blob_path(root, DIGEST_A)


def test_pull_keeps_blobs_that_verify(tmp_path: Path) -> None:
    present = blob_path(tmp_path, DIGEST_A)
    present.parent.mkdir(parents=True)
    present.write_bytes(IMAGE_A)
    handle, requests = _server(blobs={DIGEST_B: IMAGE_B})

    assert _pull(tmp_path, handle) == PullReport("seeds", 1, 1, 0)

    assert requests == [
        "/api/export/datasets/seeds",
        f"/api/export/images/{DIGEST_B}",
    ]
    assert blob_path(tmp_path, DIGEST_B).read_bytes() == IMAGE_B


def test_pull_replaces_a_cached_blob_that_fails_verification(tmp_path: Path) -> None:
    corrupted = blob_path(tmp_path, DIGEST_A)
    corrupted.parent.mkdir(parents=True)
    corrupted.write_bytes(b"bit rot")
    handle, requests = _server()

    assert _pull(tmp_path, handle) == PullReport("seeds", 0, 1, 1)

    assert requests == [
        "/api/export/datasets/seeds",
        f"/api/export/images/{DIGEST_A}",
        f"/api/export/images/{DIGEST_B}",
    ]
    assert corrupted.read_bytes() == IMAGE_A
    assert [child.name for child in corrupted.parent.iterdir()] == [DIGEST_A]


def test_verified_blob_rejects_mismatched_bytes(tmp_path: Path) -> None:
    target = blob_path(tmp_path, DIGEST_A)
    target.parent.mkdir(parents=True)
    target.write_bytes(IMAGE_B)

    with pytest.raises(BlobError, match="digest verification"):
        verified_blob(tmp_path, DIGEST_A)
    with pytest.raises(BlobError, match="missing"):
        verified_blob(tmp_path, DIGEST_B)

    target.write_bytes(IMAGE_A)
    assert verified_blob(tmp_path, DIGEST_A) == target


def test_pull_rejects_corrupted_images(tmp_path: Path) -> None:
    handle, _ = _server(blobs={DIGEST_A: IMAGE_A, DIGEST_B: b"tampered"})
    with pytest.raises(DatasetPullError, match="digest verification"):
        _pull(tmp_path, handle)

    assert blob_path(tmp_path, DIGEST_A).read_bytes() == IMAGE_A
    assert not blob_path(tmp_path, DIGEST_B).exists()
    assert not blob_path(tmp_path, DIGEST_B).parent.exists()
    assert not (tmp_path / "datasets").exists()


def test_pull_rejects_invalid_export_entries(tmp_path: Path) -> None:
    export = _export()
    export["images"][1]["digest"] = "not-a-digest"
    handle, requests = _server(export=export)
    with pytest.raises(DatasetPullError, match=r"images\[1\].digest must be a SHA-256"):
        _pull(tmp_path, handle)
    assert requests == ["/api/export/datasets/seeds"]
    assert list(tmp_path.iterdir()) == []


def test_pull_propagates_http_errors(tmp_path: Path) -> None:
    handle, _ = _server(blobs={})
    with pytest.raises(httpx.HTTPStatusError):
        _pull(tmp_path, handle)
    assert not blob_path(tmp_path, DIGEST_A).exists()
    assert not (tmp_path / "datasets").exists()


def test_pull_rejects_unknown_schema_versions(tmp_path: Path) -> None:
    export = _export()
    export["schemaVersion"] = 99
    handle, requests = _server(export=export)
    with pytest.raises(DatasetPullError, match="schemaVersion must be 1"):
        _pull(tmp_path, handle)
    assert requests == ["/api/export/datasets/seeds"]
    assert list(tmp_path.iterdir()) == []


def test_failed_pull_leaves_the_previous_manifest_untouched(tmp_path: Path) -> None:
    manifest = tmp_path / "datasets" / "seeds.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text("previous")
    handle, _ = _server(blobs={DIGEST_A: IMAGE_A, DIGEST_B: b"tampered"})

    with pytest.raises(DatasetPullError, match="digest verification"):
        _pull(tmp_path, handle)

    assert manifest.read_text() == "previous"
    assert [child.name for child in manifest.parent.iterdir()] == ["seeds.json"]


def test_pull_replaces_the_previous_manifest(tmp_path: Path) -> None:
    manifest = tmp_path / "datasets" / "seeds.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text("previous")
    handle, _ = _server()

    _pull(tmp_path, handle)

    assert json.loads(manifest.read_text()) == _export()
    assert [child.name for child in manifest.parent.iterdir()] == ["seeds.json"]
