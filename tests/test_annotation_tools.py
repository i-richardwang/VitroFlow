"""Visual task inputs, paired previews and source-coordinate correction."""

import base64
import hashlib
import json

import cv2
import numpy as np
import pytest

from vitroflow.agent_annotation.tools import AnnotationTools
from vitroflow.autoannotation.preparation import prepare
from vitroflow.autoannotation.results import collect_responses
from vitroflow.autoannotation.storage import read_json, write_json


@pytest.mark.parametrize("scale", [1, 2, 4])
@pytest.mark.parametrize("with_references", [False, True])
def test_visual_inputs_and_refitted_geometry(
    tmp_path, scale, with_references, annotation_attempt
):
    source = tmp_path / "photo.png"
    # Non-square, nonuniform pixels make an accidental resize or wrong crop visible.
    pixels = np.arange(400 * 600 * 3, dtype=np.uint8).reshape(400, 600, 3)
    cv2.imwrite(str(source), pixels)
    prelabels = tmp_path / "input.json"
    write_json(
        prelabels,
        {
            "image": {
                "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "width": 600,
                "height": 400,
            },
            "instances": [
                {
                    "id": "long:previous:round:identifier",
                    "class": "seed",
                    "bbox": {"x": 110, "y": 60, "width": 20, "height": 10},
                }
            ],
        },
    )
    package = tmp_path / "package"
    prepare(
        source,
        package,
        crop=[100, 50, 256, 128],
        prelabels_path=prelabels if with_references else None,
        config={"coreSize": 256, "halo": 32, "displayScale": scale},
    )
    coordinator, config = annotation_attempt(package)
    tools = AnnotationTools(config)
    viewed = tools.call("annotation_view", {"taskId": "tile-000-000"})
    metadata = json.loads(viewed["content"][0]["text"])
    images = [
        base64.b64decode(v["data"]) for v in viewed["content"] if v["type"] == "image"
    ]
    assert metadata["task"]["displaySize"] == [256 * scale, 128 * scale]
    assert images[1] == (package / "tasks/tile-000-000/clean.png").read_bytes()
    assert len(images) == (3 if with_references else 2)
    assert metadata["mode"] == ("refit" if with_references else "annotate")
    assert metadata["references"] == (
        [{"id": "r001", "class": "seed"}] if with_references else []
    )
    assert "candidates" not in metadata
    if with_references:
        assert images[2] == (package / "tasks/tile-000-000/before.png").read_bytes()
        assert images[2] != images[1]
        assert "zero,\none, or multiple" in metadata["instructions"]
    else:
        assert "INITIAL" not in metadata["instructions"]
    proposal = {
        "taskId": "tile-000-000",
        "instances": [
            {"id": "r001", "class": "seed", "box_2d": [250, 250, 500, 500]},
        ],
        "issues": [],
    }
    preview = tools.call("annotation_preview", proposal)
    preview_images = [
        base64.b64decode(v["data"]) for v in preview["content"] if v["type"] == "image"
    ]
    assert len(preview_images) == 2
    assert preview_images[0] == images[1]
    assert preview_images[1] != images[1]
    assert cv2.imdecode(
        np.frombuffer(preview_images[1], np.uint8), cv2.IMREAD_COLOR
    ).shape[:2] == (128 * scale, 256 * scale)
    proposal_id = json.loads(preview["content"][0]["text"])["proposalId"]
    assert tools.call(
        "annotation_submit", {"taskId": proposal["taskId"], "proposalId": proposal_id}
    )["complete"]
    collect_responses(
        package,
        tmp_path / "result",
        {k: v["response"] for k, v in coordinator.snapshot()["tasks"].items()},
    )
    output = read_json(tmp_path / "result/result.json")["instances"]
    # The reference can be completely relocated; display scale never changes source geometry.
    assert len(output) == 1
    assert output[0]["bbox"] == {"x": 164, "y": 82, "width": 64, "height": 32}


def test_preview_submission_is_persistent_bound_and_idempotent(
    tmp_path, annotation_attempt
):
    source = tmp_path / "photo.png"
    pixels = np.arange(40 * 120 * 3, dtype=np.uint8).reshape(40, 120, 3)
    cv2.imwrite(str(source), pixels)
    package = tmp_path / "package"
    prepare(source, package, config={"coreSize": 64, "halo": 0})
    assert np.array_equal(
        cv2.imread(str(package / "tasks/tile-000-000/clean.png")), pixels[:, :64]
    )
    coordinator, config = annotation_attempt(package)
    tools = AnnotationTools(config)
    preview = tools.call(
        "annotation_preview", {"taskId": "tile-000-000", "instances": []}
    )
    proposal_id = json.loads(preview["content"][0]["text"])["proposalId"]
    # Each CLI invocation constructs a new object; accepted geometry survives it.
    tools = AnnotationTools(config)
    submission = {"taskId": "tile-000-000", "proposalId": proposal_id}
    with pytest.raises(ValueError, match="different task"):
        tools.call("annotation_submit", {**submission, "taskId": "tile-000-001"})
    receipt = tools.call("annotation_submit", submission)
    assert tools.call("annotation_submit", submission) == receipt
    assert receipt["complete"]  # Completion is local to this bound session.
    assert "tasks" not in json.loads(receipt["content"][0]["text"])
    checkpoint = coordinator.snapshot()["tasks"]["tile-000-000"]
    assert checkpoint["response"]["issues"] == []
    stored = config.parent / "responses/proposals" / f"{proposal_id}.json"
    value = read_json(stored)
    value["producer"] = "changed"
    write_json(stored, value)
    # Accepted responses are owned by the coordinator, not mutable proposal files.
    assert tools.call("annotation_submit", submission) == receipt
    with pytest.raises(ValueError, match="different proposal"):
        tools.call("annotation_submit", {**submission, "proposalId": "0" * 64})


def test_cli_run_region_options_override_json(tmp_path, monkeypatch):
    from vitroflow.agent_annotation import command
    from vitroflow.cli import main

    config = tmp_path / "settings.json"
    write_json(config, {"coreSize": 512, "halo": 32, "displayScale": 2})
    received = {}

    def run(image, directory, runtime, **kwargs):
        received.update(kwargs)
        return {}

    monkeypatch.setattr(command, "run_annotation", run)
    assert (
        main(
            [
                "annotate",
                "run",
                "--runtime",
                "antigravity",
                "--image",
                "photo.jpg",
                "--output",
                str(tmp_path / "run"),
                "--config",
                str(config),
                "--core-size",
                "256",
                "--display-scale",
                "4",
            ]
        )
        == 0
    )
    assert received["config"] == {"coreSize": 256, "halo": 32, "displayScale": 4}
