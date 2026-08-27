import hashlib
import json
import os
from pathlib import Path

import httpx
import pytest

from vitroflow.annotations import load_annotations
from vitroflow.dataset_pull import DatasetPullError, pull_dataset

IMAGE = b"photograph"
LABEL = {
    "schemaVersion": 2,
    "image": {"path": "images/seeds/a.jpg", "width": 100, "height": 100},
    "source": {
        "modelVersionId": "seeds.traditional-v1",
        "artifactDigest": "a" * 64,
        "runtime": {"adapter": "traditional", "fingerprint": "b" * 64},
    },
    "status": "complete",
    "revision": 1,
    "instances": [
        {
            "id": "one",
            "class": "seed",
            "bbox": {"x": 1, "y": 1, "width": 5, "height": 5},
        }
    ],
}


def _server(
    digest: str | None,
    *,
    source: str = "images/seeds/a.jpg",
    images: bool = True,
    schema_version: int = 1,
):
    requests: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        assert request.headers["Authorization"] == "Bearer secret"
        if request.url.path == "/api/export/datasets/seeds":
            return httpx.Response(
                200,
                json={
                    "schemaVersion": schema_version,
                    "dataset": "seeds",
                    "images": [
                        {
                            "dataset": "seeds",
                            "stem": "a",
                            "source": source,
                            "digest": digest,
                            "prelabel": {"schema_version": 2, "note": "opaque"},
                            "label": LABEL,
                        },
                        {
                            "dataset": "seeds",
                            "stem": "b",
                            "source": "images/seeds/b.png",
                            "digest": digest,
                            "prelabel": None,
                            "label": None,
                        },
                    ],
                },
            )
        if images and request.url.path.startswith("/api/export/datasets/seeds/images/"):
            return httpx.Response(200, content=IMAGE)
        return httpx.Response(404)

    return handle, requests


def test_pull_rebuilds_the_local_data_layout(tmp_path: Path) -> None:
    handle, requests = _server(hashlib.sha256(IMAGE).hexdigest())
    root = tmp_path / "data"

    count = pull_dataset(
        "https://workbench.example",
        "secret",
        "seeds",
        root,
        transport=httpx.MockTransport(handle),
    )

    assert count == 2
    assert (root / "images" / "seeds" / "a.jpg").read_bytes() == IMAGE
    assert (root / "images" / "seeds" / "b.png").read_bytes() == IMAGE
    assert json.loads((root / "labels" / "seeds" / "a.json").read_text()) == LABEL
    assert (root / "prelabels" / "seeds" / "a.json").exists()
    assert not (root / "labels" / "seeds" / "b.json").exists()
    assert requests == [
        "/api/export/datasets/seeds",
        "/api/export/datasets/seeds/images/a",
        "/api/export/datasets/seeds/images/b",
    ]
    annotations = load_annotations(root / "labels", root)
    assert [annotation.status for annotation in annotations] == ["complete"]


def test_pull_rejects_corrupted_images(tmp_path: Path) -> None:
    handle, _ = _server("0" * 64)
    with pytest.raises(DatasetPullError, match="digest mismatch"):
        pull_dataset(
            "https://workbench.example",
            "secret",
            "seeds",
            tmp_path,
            transport=httpx.MockTransport(handle),
        )

    assert not (tmp_path / "images").exists()
    assert [child.name for child in tmp_path.iterdir()] == []


def test_pull_rejects_missing_digests(tmp_path: Path) -> None:
    handle, _ = _server(None)
    with pytest.raises(DatasetPullError, match="missing digest"):
        pull_dataset(
            "https://workbench.example",
            "secret",
            "seeds",
            tmp_path,
            transport=httpx.MockTransport(handle),
        )
    assert not (tmp_path / "images").exists()


def test_pull_rejects_sources_outside_the_dataset(tmp_path: Path) -> None:
    handle, requests = _server(
        hashlib.sha256(IMAGE).hexdigest(), source="images/seeds/../a.jpg"
    )
    with pytest.raises(DatasetPullError, match="Unexpected image source"):
        pull_dataset(
            "https://workbench.example",
            "secret",
            "seeds",
            tmp_path,
            transport=httpx.MockTransport(handle),
        )
    assert requests == ["/api/export/datasets/seeds"]
    assert not (tmp_path / "images").exists()


def test_pull_propagates_http_errors(tmp_path: Path) -> None:
    handle, _ = _server(hashlib.sha256(IMAGE).hexdigest(), images=False)
    with pytest.raises(httpx.HTTPStatusError):
        pull_dataset(
            "https://workbench.example",
            "secret",
            "seeds",
            tmp_path,
            transport=httpx.MockTransport(handle),
        )
    assert not (tmp_path / "images" / "seeds" / "a.jpg").exists()


def _seed_local_tree(root: Path) -> None:
    for relative in (
        "images/seeds/stale.jpg",
        "labels/seeds/stale.json",
        "prelabels/seeds/stale.json",
        "images/other/keep.jpg",
    ):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"previous")


def test_pull_rejects_unknown_schema_versions(tmp_path: Path) -> None:
    handle, requests = _server(hashlib.sha256(IMAGE).hexdigest(), schema_version=2)
    with pytest.raises(DatasetPullError, match="schema version"):
        pull_dataset(
            "https://workbench.example",
            "secret",
            "seeds",
            tmp_path,
            transport=httpx.MockTransport(handle),
        )
    assert requests == ["/api/export/datasets/seeds"]
    assert [child.name for child in tmp_path.iterdir()] == []


def test_failed_pull_leaves_the_existing_tree_untouched(tmp_path: Path) -> None:
    _seed_local_tree(tmp_path)
    handle, _ = _server(hashlib.sha256(IMAGE).hexdigest(), images=False)
    with pytest.raises(httpx.HTTPStatusError):
        pull_dataset(
            "https://workbench.example",
            "secret",
            "seeds",
            tmp_path,
            transport=httpx.MockTransport(handle),
        )

    assert (tmp_path / "images" / "seeds" / "stale.jpg").read_bytes() == b"previous"
    assert (tmp_path / "labels" / "seeds" / "stale.json").read_bytes() == b"previous"
    assert not (tmp_path / "images" / "seeds" / "a.jpg").exists()
    assert sorted(child.name for child in tmp_path.iterdir()) == [
        "images",
        "labels",
        "prelabels",
    ]


def test_pull_removes_local_files_absent_from_the_export(tmp_path: Path) -> None:
    _seed_local_tree(tmp_path)
    handle, _ = _server(hashlib.sha256(IMAGE).hexdigest())

    pull_dataset(
        "https://workbench.example",
        "secret",
        "seeds",
        tmp_path,
        transport=httpx.MockTransport(handle),
    )

    assert not (tmp_path / "images" / "seeds" / "stale.jpg").exists()
    assert not (tmp_path / "labels" / "seeds" / "stale.json").exists()
    assert not (tmp_path / "prelabels" / "seeds" / "stale.json").exists()
    assert (tmp_path / "images" / "seeds" / "a.jpg").read_bytes() == IMAGE
    assert (tmp_path / "images" / "other" / "keep.jpg").read_bytes() == b"previous"
    assert sorted(child.name for child in tmp_path.iterdir()) == [
        "images",
        "labels",
        "prelabels",
    ]


def test_failed_replacement_restores_all_existing_trees(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_local_tree(tmp_path)
    handle, _ = _server(hashlib.sha256(IMAGE).hexdigest())
    rename = os.rename
    replacements = 0

    def fail_during_second_replacement(source: Path, target: Path) -> None:
        nonlocal replacements
        if ".pull-seeds-" in str(source) and str(target).endswith("/seeds"):
            replacements += 1
            if replacements == 2:
                raise OSError("replacement failed")
        rename(source, target)

    monkeypatch.setattr(
        "vitroflow.dataset_pull.os.rename", fail_during_second_replacement
    )
    with pytest.raises(OSError, match="replacement failed"):
        pull_dataset(
            "https://workbench.example",
            "secret",
            "seeds",
            tmp_path,
            transport=httpx.MockTransport(handle),
        )

    assert (tmp_path / "images" / "seeds" / "stale.jpg").read_bytes() == b"previous"
    assert (tmp_path / "labels" / "seeds" / "stale.json").read_bytes() == b"previous"
    assert (tmp_path / "prelabels" / "seeds" / "stale.json").read_bytes() == b"previous"
    assert not (tmp_path / "images" / "seeds" / "a.jpg").exists()
