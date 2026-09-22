from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

from vitroflow.agent_annotation.tools import DEFINITIONS
from vitroflow.agent_runtimes import pi
from vitroflow.agent_runtimes.process import runtime_environment, terminate_process
from vitroflow.autoannotation.preparation import prepare
from vitroflow.autoannotation.results import collect_responses
from vitroflow.autoannotation.storage import read_json, write_json


@pytest.mark.skipif(shutil.which("pi") is None, reason="Pi is installed separately")
def test_native_tool_registration_preview_and_submit(tmp_path, annotation_attempt):
    source = tmp_path / "source.png"
    cv2.imwrite(str(source), np.full((40, 80, 3), 128, np.uint8))
    package = tmp_path / "package"
    candidates = tmp_path / "candidates.json"
    write_json(
        candidates,
        {
            "image": {
                "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "width": 80,
                "height": 40,
            },
            "instances": [
                {
                    "id": "candidate",
                    "class": "seed",
                    "bbox": {"x": 32, "y": 12, "width": 32, "height": 16},
                }
            ],
        },
    )
    prepare(
        source,
        package,
        crop=[16, 8, 64, 32],
        prelabels_path=candidates,
        config={"displayScale": 3},
    )
    coordinator, config = annotation_attempt(package)
    extension = tmp_path / "annotation.ts"
    shutil.copyfile(Path(pi.__file__).with_name("pi_tools.ts"), extension)
    write_json(
        tmp_path / "tools.json",
        {
            "command": [
                sys.executable,
                "-m",
                "vitroflow.agent_annotation.tools",
                "--config",
                str(config),
            ],
            "definitions": DEFINITIONS,
        },
    )
    result = tmp_path / "probe.json"
    probe = tmp_path / "probe.ts"
    probe.write_text(
        """
import annotation from "./annotation.ts";
import { writeFileSync } from "node:fs";
export default async function(pi) {
  const definitions = new Map();
  await annotation(new Proxy(pi, { get(target, property) {
    if (property === "registerTool") return (tool) => {
      definitions.set(tool.name, tool); return target.registerTool(tool);
    };
    return target[property];
  }}));
  pi.on("session_start", async (_event, context) => {
    let result;
    try {
      const invoke = (name, args) => definitions.get(name).execute("test", args, undefined, undefined, context);
      const view = await invoke("annotation_view", { taskId: "tile-000-000" });
      const metadata = JSON.parse(view.content.find(v => v.type === "text").text);
      const value = { taskId: "tile-000-000", instances: [{ id: "one", class: "seed", box_2d: [125.5, 250.25, 625.5, 750.25] }], issues: [{ box_2d: [0, 0, 1000, 1000], reason: "Boundary test" }] };
      const invalid = [[0, -1, 100, 100], [0, 0, 1001, 100], [10, 0, 5, 100], [0, 20, 100, 10], [0, 0, 0, 100], [0, 0, 100], [0, 0, NaN, 100]];
      let rejected = 0;
      for (const box_2d of invalid) {
        try { await invoke("annotation_preview", { ...value, instances: [{ ...value.instances[0], box_2d }] }); }
        catch { rejected++; }
      }
      const preview = await invoke("annotation_preview", value);
      const proposalId = JSON.parse(preview.content.find(v => v.type === "text").text).proposalId;
      const accepted = await invoke("annotation_submit", { taskId: value.taskId, proposalId });
      result = { metadata, previewMetadata: JSON.parse(preview.content.find(v => v.type === "text").text), tools: pi.getActiveTools(), viewImages: view.content.filter(v => v.type === "image").length, previewImages: preview.content.filter(v => v.type === "image").length, rejected, terminate: accepted.terminate };
    } catch(error) { result = { error: String(error) }; }
    writeFileSync(RESULT_PATH, JSON.stringify(result));
  });
}
""".replace("RESULT_PATH", json.dumps(str(result)))
    )
    process = subprocess.Popen(
        [
            "pi",
            "--mode",
            "rpc",
            "--no-session",
            "--no-extensions",
            "--no-skills",
            "--no-context-files",
            "--tools",
            "annotation_view,annotation_preview,annotation_submit",
            "--extension",
            str(probe),
        ],
        cwd=tmp_path,
        env=runtime_environment(),
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 20
        while (
            not result.exists()
            and process.poll() is None
            and time.monotonic() < deadline
        ):
            time.sleep(0.05)
        assert result.exists(), "Pi did not initialize the native annotation tools"
    finally:
        terminate_process(process)
        if process.stdin:
            process.stdin.close()
        if process.stderr:
            process.stderr.close()
    observed = read_json(result)
    metadata = observed.pop("metadata")
    assert metadata["task"] == {
        "id": "tile-000-000",
        "displaySize": [192, 96],
        "coordinateSpace": "box_2d: [ymin, xmin, ymax, xmax], normalized 0–1000",
    }
    assert metadata["mode"] == "refit"
    assert metadata["references"] == [{"id": "r001", "class": "seed"}]
    assert "candidates" not in metadata
    preview_metadata = observed.pop("previewMetadata")
    assert len(preview_metadata.pop("proposalId")) == 64
    assert preview_metadata == metadata["task"]
    assert observed == {
        "tools": ["annotation_view", "annotation_preview", "annotation_submit"],
        "viewImages": 3,
        "previewImages": 2,
        "rejected": 7,
        "terminate": True,
    }
    assert coordinator.events["tile-000-000"].is_set()

    collect_responses(
        package,
        tmp_path / "result",
        {k: v["response"] for k, v in coordinator.snapshot()["tasks"].items()},
    )
    document = read_json(tmp_path / "result/result.json")
    assert document["instances"][0]["bbox"] == pytest.approx(
        {"x": 32.016, "y": 12.016, "width": 32, "height": 16}
    )
    assert document["issues"][0]["bbox"] == {
        "x": 16,
        "y": 8,
        "width": 64,
        "height": 32,
    }
