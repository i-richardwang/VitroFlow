"""Exercise the installed Pi extension API without sending a model request."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

from vitroflow.agent_annotation import runner
from vitroflow.agent_runtimes.pi import runtime_environment, terminate_process
from vitroflow.autoannotation.preparation import prepare
from vitroflow.autoannotation.storage import read_json, write_json
from vitroflow.autoannotation.tasks import status


@pytest.mark.skipif(shutil.which("pi") is None, reason="Pi is installed separately")
def test_native_tool_registration_preview_and_submit(tmp_path):
    source = tmp_path / "source.png"
    cv2.imwrite(str(source), np.full((32, 32, 3), 128, np.uint8))
    package = tmp_path / "package"
    prepare(source, package)
    extension = tmp_path / "annotation.ts"
    shutil.copyfile(Path(runner.__file__).with_name("pi_tools.ts"), extension)
    write_json(
        tmp_path / "config.json",
        {
            "command": [sys.executable, "-m", "vitroflow.cli"],
            "package": str(package),
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
      const value = { taskId: "tile-000-000", instances: [{ id: "one", class: "seed", bbox: { x: 4, y: 5, width: 10, height: 12 } }], issues: [] };
      let rejected = false;
      try { await invoke("annotation_preview", { ...value, instances: [{ ...value.instances[0], bbox: { x: 100, y: 100, width: 10, height: 12 } }] }); }
      catch { rejected = true; }
      const preview = await invoke("annotation_preview", value);
      const accepted = await invoke("annotation_submit", value);
      result = { tools: pi.getActiveTools(), viewImage: view.content.some(v => v.type === "image"), previewImage: preview.content.some(v => v.type === "image"), rejected, terminate: accepted.terminate };
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
    assert read_json(result) == {
        "tools": ["annotation_view", "annotation_preview", "annotation_submit"],
        "viewImage": True,
        "previewImage": True,
        "rejected": True,
        "terminate": True,
    }
    assert status(package)["complete"]
