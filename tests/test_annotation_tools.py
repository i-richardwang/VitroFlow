"""Visual task inputs, paired previews and source-coordinate correction."""

import base64
import hashlib
import json

import cv2
import numpy as np
import pytest

from vitroflow.agent_annotation.tools import AnnotationTools
from vitroflow.autoannotation.preparation import prepare
from vitroflow.autoannotation.results import collect
from vitroflow.autoannotation.storage import read_json, write_json


@pytest.mark.parametrize("scale", [1, 2, 4])
@pytest.mark.parametrize("with_references", [False, True])
def test_visual_inputs_and_refitted_geometry(tmp_path, scale, with_references):
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
    config = tmp_path / "tools/config.json"
    write_json(config, {"package": str(package), "producer": "test/vision"})
    tools = AnnotationTools(config)
    viewed = tools.call("annotation_view", {"taskId": "tile-000-000"})
    metadata = json.loads(viewed["content"][0]["text"])
    images = [
        base64.b64decode(v["data"]) for v in viewed["content"] if v["type"] == "image"
    ]
    assert metadata["task"]["displaySize"] == [256 * scale, 128 * scale]
    assert images[0] == (package / "tasks/tile-000-000/clean.png").read_bytes()
    assert len(images) == (2 if with_references else 1)
    assert metadata["mode"] == ("refit" if with_references else "annotate")
    assert metadata["references"] == (
        [{"id": "r001", "class": "seed"}] if with_references else []
    )
    assert "candidates" not in metadata
    if with_references:
        assert images[1] == (package / "tasks/tile-000-000/before.png").read_bytes()
        assert images[1] != images[0]
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
    assert preview_images[0] == images[0]
    assert preview_images[1] != images[0]
    assert cv2.imdecode(
        np.frombuffer(preview_images[1], np.uint8), cv2.IMREAD_COLOR
    ).shape[:2] == (128 * scale, 256 * scale)
    assert tools.call("annotation_submit", proposal)["complete"]
    collect(package, tmp_path / "result")
    output = read_json(tmp_path / "result/result.json")["instances"]
    # The reference can be completely relocated; display scale never changes source geometry.
    assert len(output) == 1
    assert output[0]["bbox"] == {"x": 164, "y": 82, "width": 64, "height": 32}


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
