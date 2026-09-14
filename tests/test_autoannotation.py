"""Single-pass completion, portable round trips and geometry across executions."""

from __future__ import annotations

import copy
import json

import cv2
import numpy as np
import pytest

from vitroflow.autoannotation import preparation, results, tasks
from vitroflow.autoannotation.protocol import SCHEMA_VERSION, digest
from vitroflow.autoannotation.storage import read_json, write_image, write_json
from vitroflow.cli import main


def item(key, x, y, w, h, **flags):
    return {
        "id": key,
        "class": "seed",
        "bbox": {"x": x, "y": y, "width": w, "height": h},
        **flags,
    }


def response(manifest, task, items=(), issues=()):
    return {
        "schemaVersion": SCHEMA_VERSION,
        "packageId": manifest["packageId"],
        "taskId": task["id"],
        "producer": "test-fixture",
        "instances": list(items),
        "issues": list(issues),
    }


@pytest.fixture
def photo(tmp_path):
    path = tmp_path / "photo.png"
    write_image(path, np.zeros((96, 128, 3), np.uint8))
    return path


def test_cli_completion_and_round_trip(photo, tmp_path, capsys):
    run = tmp_path / "round1"
    assert (
        main(["annotate", "prepare", "--image", str(photo), "--output", str(run)]) == 0
    )
    m = tasks.load_package(run)
    t = m["tasks"][0]
    assert m["schemaVersion"] == SCHEMA_VERSION
    with pytest.raises(ValueError, match="Incomplete"):
        results.collect(run, tmp_path / "premature")
    a = response(m, t, [item("s1", 40, 40, 20, 12, uncertain=True)])
    file = tmp_path / "response.json"
    write_json(file, a)
    assert (
        main(
            [
                "annotate",
                "submit",
                "--run",
                str(run),
                "--task",
                t["id"],
                "--file",
                str(file),
            ]
        )
        == 0
    )
    receipt = tasks.status(run)
    assert receipt["complete"]
    assert receipt["tasks"][0]["uncertainInstances"] == 1
    result_dir = tmp_path / "result1"
    assert (
        main(["annotate", "collect", "--run", str(run), "--output", str(result_dir)])
        == 0
    )
    result = read_json(result_dir / "result.json")
    assert result["reviewStatus"] == "unreviewed"
    assert result["qualityStatus"] == "needs-review"
    assert result["instances"][0]["bbox"] == {
        "x": 20,
        "y": 20,
        "width": 10,
        "height": 6,
    }
    assert result["inputDigest"] is None
    assert read_json(result_dir / "responses.json")["responses"][0] == a
    assert not np.any(cv2.imread(str(result_dir / "before-overlay.png")))
    old_bytes = {p.name: p.read_bytes() for p in result_dir.iterdir()}

    # The public result is accepted directly; different crop and display scale
    # must not double-transform source coordinates or carry old local flags.
    second = tmp_path / "round2"
    preparation.prepare(
        photo,
        second,
        prelabels_path=result_dir / "result.json",
        crop=[10, 10, 60, 50],
        config={"displayScale": 3},
    )
    m2 = tasks.load_package(second)
    t2 = m2["tasks"][0]
    local = read_json(second / "tasks" / t2["id"] / "prelabels.json")["instances"]
    assert local[0]["bbox"] == {"x": 30, "y": 30, "width": 30, "height": 18}
    assert read_json(second / "input.json") == result
    # Replace the candidate with two objects, add one, no per-input decisions.
    b = response(
        m2,
        t2,
        [
            item("a", 30, 30, 12, 18),
            item("b", 48, 30, 12, 18),
            item("new", 100, 60, 15, 9),
        ],
    )
    before = tasks.status(second)
    preview = tmp_path / "preview"
    tasks.preview(second, t2["id"], b, preview)
    assert tasks.status(second) == before
    assert cv2.imread(str(preview / "before.png")).shape[:2] == (150, 180)
    tasks.submit(second, t2["id"], b)
    results.collect(second, tmp_path / "result2")
    r2 = read_json(tmp_path / "result2/result.json")
    assert len(r2["instances"]) == 3 and r2["qualityStatus"] == "unverified"
    assert r2["inputDigest"] == m2["assets"]["input.json"]
    assert read_json(tmp_path / "result2/input.json") == result
    assert old_bytes == {p.name: p.read_bytes() for p in result_dir.iterdir()}
    with pytest.raises(FileExistsError):
        results.collect(second, result_dir)
    assert capsys.readouterr().err == ""


def test_plan_defaults_and_validates_input_without_writes(photo, tmp_path, capsys):
    before = set(tmp_path.iterdir())
    assert main(["annotate", "plan", "--image", str(photo)]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["minimumSubmissions"] == 1
    assert set(tmp_path.iterdir()) == before
    bad = tmp_path / "bad.json"
    write_json(bad, {"image": {}, "instances": []})
    with pytest.raises(ValueError, match="identity"):
        preparation.prepare(photo, None, prelabels_path=bad, plan_only=True)


def test_fail_retry_and_reset(photo, tmp_path):
    run = tmp_path / "run"
    preparation.prepare(photo, run)
    m = tasks.load_package(run)
    t = m["tasks"][0]
    a = response(m, t)
    tasks.fail(run, t["id"], "executor unavailable")
    assert tasks.status(run)["tasks"][0]["state"] == "failed"
    assert tasks.submit(run, t["id"], a)["state"] == "complete"
    assert tasks.submit(run, t["id"], a)["state"] == "complete"
    with pytest.raises(ValueError, match="already accepted"):
        tasks.submit(run, t["id"], response(m, t, [item("s", 8, 8, 12, 10)]))
    tasks.reset(run, t["id"])
    assert tasks.status(run)["tasks"][0]["state"] == "pending"
    assert read_json(next((run / "history").iterdir()))["response"] == a
    tasks.submit(run, t["id"], a)
    results.collect(run, tmp_path / "empty-result")
    assert read_json(tmp_path / "empty-result/result.json")["instances"] == []


@pytest.mark.parametrize(
    "bad",
    [
        "wrong-image",
        "wrong-size",
        "coordinates",
        "version",
        "duplicate",
        "bbox",
        "nan",
        "class",
    ],
)
def test_result_import_rejects_incompatible_or_invalid_data(photo, tmp_path, bad):
    r = {
        "kind": "ai-annotation-result",
        "schemaVersion": SCHEMA_VERSION,
        "coordinateSpace": "oriented source pixels",
        "image": {"sha256": digest(photo.read_bytes()), "width": 128, "height": 96},
        "instances": [item("s", 8, 8, 12, 10)],
    }
    if bad == "wrong-image":
        r["image"]["sha256"] = "wrong"
    elif bad == "wrong-size":
        r["image"]["width"] = 64
    elif bad == "coordinates":
        r["coordinateSpace"] = "tile pixels"
    elif bad == "version":
        r["schemaVersion"] = "unknown"
    elif bad == "duplicate":
        r["instances"] *= 2
    elif bad == "bbox":
        r["instances"][0]["bbox"]["width"] = 999
    elif bad == "nan":
        r["instances"][0]["bbox"]["x"] = float("nan")
    elif bad == "class":
        r["instances"][0]["class"] = "other"
    path = tmp_path / "result.json"
    path.write_text(json.dumps(r))
    with pytest.raises(ValueError):
        preparation.prepare(photo, tmp_path / "run", prelabels_path=path)
    assert not (tmp_path / "run").exists()


def test_multitile_roundtrip_preserves_geometry_and_requires_empty_tiles(
    photo, tmp_path
):
    original = [
        item("left", 20, 20, 8, 8),
        item("seam", 58, 22, 12, 8),
        item("right", 88, 30, 9, 10),
    ]
    supplied = tmp_path / "input.json"
    write_json(
        supplied,
        {
            "image": {"sha256": digest(photo.read_bytes()), "width": 128, "height": 96},
            "instances": original,
        },
    )
    for index, core, scale in [(1, 64, 2), (2, 32, 3)]:
        run = tmp_path / f"run{index}"
        preparation.prepare(
            photo,
            run,
            prelabels_path=supplied,
            config={"coreSize": core, "halo": 16, "displayScale": scale},
        )
        m = tasks.load_package(run)
        for i, t in enumerate(m["tasks"]):
            if i == len(m["tasks"]) - 1:
                with pytest.raises(ValueError, match="Incomplete"):
                    results.collect(run, tmp_path / "unfinished")
            candidates = read_json(run / "tasks" / t["id"] / "prelabels.json")[
                "instances"
            ]
            # A deterministic executor fixture returns complete visible objects;
            # this checks geometry, not a model's visual accuracy.
            outputs = [{k: p[k] for k in ("id", "class", "bbox")} for p in candidates]
            tasks.submit(run, t["id"], response(m, t, outputs))
        out = tmp_path / f"result{index}"
        results.collect(run, out)
        result = read_json(out / "result.json")
        assert len(result["instances"]) == 3 and result["warnings"] == []
        assert sorted(
            (v["bbox"]["x"], v["bbox"]["width"]) for v in result["instances"]
        ) == [(20, 8), (58, 12), (88, 9)]
        supplied = out / "result.json"


def test_issues_and_overlap_are_not_silently_approved_or_suppressed(photo, tmp_path):
    run = tmp_path / "run"
    preparation.prepare(photo, run, crop=[10, 10, 80, 60])
    m = tasks.load_package(run)
    t = m["tasks"][0]
    issue = {"bbox": {"x": 30, "y": 40, "width": 10, "height": 20}, "reason": "glare"}
    a = response(m, t, [item("a", 20, 20, 20, 12), item("b", 22, 22, 20, 12)], [issue])
    bad = copy.deepcopy(a)
    bad["issues"][0]["bbox"]["width"] = 999
    with pytest.raises(ValueError, match="outside"):
        tasks.submit(run, t["id"], bad)
    tasks.submit(run, t["id"], a)
    results.collect(run, tmp_path / "result")
    result = read_json(tmp_path / "result/result.json")
    assert len(result["instances"]) == 2 and result["warnings"] == []
    assert result["qualityStatus"] == "needs-review"
    assert result["issues"][0]["bbox"] == {"x": 25, "y": 30, "width": 5, "height": 10}


@pytest.mark.parametrize(
    "mutation",
    [
        "package",
        "task",
        "schema",
        "extra",
        "missing",
        "duplicate",
        "boolean",
        "negative",
        "nonfinite",
        "class",
        "producer",
        "issue",
    ],
)
def test_invalid_response_is_rejected_without_acceptance(photo, tmp_path, mutation):
    run = tmp_path / "run"
    preparation.prepare(photo, run)
    manifest = tasks.load_package(run)
    task = manifest["tasks"][0]
    value = response(manifest, task, [item("s", 8, 8, 10, 10)])
    if mutation == "package":
        value["packageId"] = "different"
    elif mutation == "task":
        value["taskId"] = "different"
    elif mutation == "schema":
        value["schemaVersion"] = "unknown"
    elif mutation == "extra":
        value["extra"] = True
    elif mutation == "missing":
        del value["instances"]
    elif mutation == "duplicate":
        value["instances"] *= 2
    elif mutation == "boolean":
        value["instances"][0]["bbox"]["x"] = True
    elif mutation == "negative":
        value["instances"][0]["bbox"]["width"] = -1
    elif mutation == "nonfinite":
        value["instances"][0]["bbox"]["x"] = float("inf")
    elif mutation == "class":
        value["instances"][0]["class"] = "unsupported"
    elif mutation == "producer":
        value["producer"] = " "
    elif mutation == "issue":
        value["issues"] = [
            {"bbox": {"x": 0, "y": 0, "width": 10, "height": 10}, "reason": ""}
        ]
    with pytest.raises(ValueError):
        tasks.submit(run, task["id"], value)
    assert tasks.status(run)["tasks"][0]["state"] == "pending"
    assert not (run / "checkpoints").exists()


def test_patch_edge_rejection_and_source_coverage_clipping(photo, tmp_path):
    run = tmp_path / "run"
    preparation.prepare(
        photo,
        run,
        crop=[0, 10, 96, 64],
        config={"coreSize": 32, "halo": 8, "displayScale": 2},
    )
    manifest = tasks.load_package(run)
    task = manifest["tasks"][0]
    # Center belongs to core [0,32), but right edge reaches internal patch x=40.
    with pytest.raises(ValueError, match="internal patch edge"):
        tasks.submit(
            run, task["id"], response(manifest, task, [item("cut", 20, 10, 60, 12)])
        )
    tasks.submit(
        run, task["id"], response(manifest, task, [item("edge", 0, 0, 10, 10)])
    )
    for other in manifest["tasks"][1:]:
        tasks.submit(run, other["id"], response(manifest, other))
    results.collect(run, tmp_path / "out")
    result = read_json(tmp_path / "out/result.json")
    assert result["instances"][0]["bbox"] == {"x": 0, "y": 10, "width": 5, "height": 5}
    assert result["instances"][0]["truncated"]
    assert result["instances"][0]["coverageTruncated"]
    assert result["qualityStatus"] == "needs-review"


def test_seam_warning_keeps_both_outputs(photo, tmp_path):
    run = tmp_path / "run"
    preparation.prepare(
        photo,
        run,
        crop=[0, 0, 64, 32],
        config={"coreSize": 32, "halo": 16, "displayScale": 1},
    )
    manifest = tasks.load_package(run)
    left, right = manifest["tasks"]
    tasks.submit(run, left["id"], response(manifest, left, [item("a", 22, 10, 18, 10)]))
    tasks.submit(
        run, right["id"], response(manifest, right, [item("b", 8, 10, 18, 10)])
    )
    results.collect(run, tmp_path / "out")
    result = read_json(tmp_path / "out/result.json")
    assert len(result["instances"]) == 2
    assert result["warnings"][0]["code"] == "possible-seam-duplicate"
    assert result["qualityStatus"] == "needs-review"


def test_portability_integrity_and_checkpoint_recovery(photo, tmp_path):
    import shutil

    root = tmp_path / "run"
    preparation.prepare(photo, root)
    manifest = tasks.load_package(root)
    task = manifest["tasks"][0]
    value = response(manifest, task)
    moved = tmp_path / "moved"
    shutil.move(root, moved)
    photo.unlink()
    tasks.submit(moved, task["id"], value)
    checkpoint = moved / "checkpoints" / f"{task['id']}.json"
    checkpoint.write_bytes(b"interrupted-json")
    assert tasks.status(moved)["tasks"][0]["state"] == "invalid"
    with pytest.raises(ValueError):
        results.collect(moved, tmp_path / "invalid")
    tasks.reset(moved, task["id"])
    assert next((moved / "history").iterdir()).read_bytes() == b"interrupted-json"
    tasks.submit(moved, task["id"], value)
    results.collect(moved, tmp_path / "valid")
    image_path = moved / "tasks" / task["id"] / "clean.png"
    image_path.write_bytes(b"changed")
    with pytest.raises(ValueError, match="Frozen asset changed"):
        tasks.status(moved)


def test_manifest_integrity_and_asset_containment(photo, tmp_path):
    from vitroflow.autoannotation.protocol import object_digest

    root = tmp_path / "run"
    preparation.prepare(photo, root)
    manifest = tasks.load_package(root)
    changed = copy.deepcopy(manifest)
    changed["coverage"]["fullImage"] = False
    write_json(root / "manifest.json", changed)
    with pytest.raises(ValueError, match="integrity mismatch"):
        tasks.load_package(root)
    changed = copy.deepcopy(manifest)
    changed["assets"]["../photo.png"] = digest(photo.read_bytes())
    changed["packageId"] = object_digest(
        {k: v for k, v in changed.items() if k != "packageId"}
    )
    write_json(root / "manifest.json", changed)
    with pytest.raises(ValueError, match="escapes package"):
        tasks.load_package(root)


def test_output_containment_and_process_lock(photo, tmp_path):
    root = tmp_path / "run"
    preparation.prepare(photo, root)
    manifest = tasks.load_package(root)
    task = manifest["tasks"][0]
    value = response(manifest, task)
    with pytest.raises(ValueError, match="outside"):
        tasks.preview(root, task["id"], value, root / "preview")
    with pytest.raises(ValueError, match="outside"):
        results.collect(root, root / "result")
    with tasks.locked(root), pytest.raises(RuntimeError, match="busy"):
        tasks.submit(root, task["id"], value)
    assert tasks.status(root)["tasks"][0]["state"] == "pending"


def test_exif_orientation_and_tile_pixels(tmp_path):
    import struct

    pixels = np.zeros((30, 50, 3), np.uint8)
    pixels[:10, :20] = [20, 100, 220]
    ok, jpg = cv2.imencode(".jpg", pixels)
    assert ok
    tiff = (
        b"II"
        + struct.pack("<HIH", 42, 8, 1)
        + struct.pack("<HHIHHI", 0x112, 3, 1, 6, 0, 0)
    )
    exif = b"Exif\x00\x00" + tiff
    encoded = jpg.tobytes()
    encoded = (
        encoded[:2]
        + b"\xff\xe1"
        + struct.pack(">H", len(exif) + 2)
        + exif
        + encoded[2:]
    )
    photo = tmp_path / "rotated.jpg"
    photo.write_bytes(encoded)
    root = tmp_path / "run"
    preparation.prepare(
        photo, root, config={"coreSize": 32, "halo": 4, "displayScale": 2}
    )
    manifest = tasks.load_package(root)
    source = cv2.imread(str(root / "source.png"))
    assert source.shape[:2] == (50, 30)
    assert manifest["source"]["width"] == 30 and manifest["source"]["height"] == 50
    assert np.array_equal(
        source, cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_COLOR)
    )
    coverage = np.zeros(source.shape[:2], np.uint8)
    for task in manifest["tasks"]:
        left, top, right, bottom = task["core"]
        coverage[top:bottom, left:right] += 1
        left, top, right, bottom = task["patch"]
        expected = cv2.resize(
            source[top:bottom, left:right],
            tuple(task["displaySize"]),
            interpolation=cv2.INTER_CUBIC,
        )
        assert np.array_equal(
            cv2.imread(str(root / "tasks" / task["id"] / "clean.png")), expected
        )
    assert np.all(coverage == 1)


@pytest.mark.parametrize(
    "config",
    [
        {"coreSize": True},
        {"halo": 513},
        {"displayScale": 0},
        {"classes": []},
        {"classes": ["other"]},
    ],
)
def test_invalid_config_has_no_output(photo, tmp_path, config):
    with pytest.raises(ValueError):
        preparation.prepare(photo, tmp_path / "run", config=config)
    assert not (tmp_path / "run").exists()


def test_custom_rules_and_cli_overrides(photo, tmp_path, capsys):
    config = tmp_path / "config.json"
    write_json(
        config,
        {"coreSize": 64, "classes": ["grain"], "rules": "Mark each visible grain."},
    )
    root = tmp_path / "run"
    assert (
        main(
            [
                "annotate",
                "prepare",
                "--image",
                str(photo),
                "--output",
                str(root),
                "--config",
                str(config),
                "--core-size",
                "128",
            ]
        )
        == 0
    )
    manifest = tasks.load_package(root)
    assert manifest["config"]["coreSize"] == 128
    task = manifest["tasks"][0]
    value = response(manifest, task, [item("g", 20, 20, 10, 10)])
    value["instances"][0]["class"] = "grain"
    tasks.submit(root, task["id"], value)
    results.collect(root, tmp_path / "result")
    assert (
        read_json(tmp_path / "result/result.json")["instances"][0]["class"] == "grain"
    )
    assert capsys.readouterr().err == ""
