from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

from vitroflow.agent_annotation.runner import run_annotation
from vitroflow.agent_runtimes.contract import AgentInterruptedError, ToolSet
from vitroflow.agent_runtimes.pi import PiRuntime
from vitroflow.autoannotation.storage import read_json


@pytest.fixture
def pi(tmp_path):
    fixture = Path(__file__).parent / "fixtures" / "pi_runtime.py"
    executable = tmp_path / "pi fixture"
    executable.write_text(f"#!{sys.executable}\n" + fixture.read_text())
    executable.chmod(0o700)
    return str(executable)


@pytest.fixture
def photo(tmp_path):
    path = tmp_path / "image.png"
    cv2.imwrite(str(path), np.full((80, 160, 3), 128, np.uint8))
    return path


def test_supervised_collection_and_private_environment(
    pi, photo, tmp_path, monkeypatch
):
    monkeypatch.setenv("VITROFLOW_WORKER_TOKEN", "must-not-inherit")
    progress = []
    report = run_annotation(
        photo,
        tmp_path / "run",
        PiRuntime("test/vision", pi),
        config={"coreSize": 64, "halo": 16},
        progress=lambda done, total: progress.append((done, total)),
    )
    result = read_json(tmp_path / "run/result/result.json")
    assert result["coverage"]["fullImage"]
    assert result["image"]["width"] == 160
    assert len(result["checkpointDigests"]) == 6
    assert progress[0] == (0, 6) and progress[-1] == (6, 6)
    assert len(report["execution"]["tasks"]) == 6
    assert (
        len(list((tmp_path / "run/attempts").glob("*/*/runtime/environment.json"))) == 6
    )
    assert (
        read_json(
            next((tmp_path / "run/attempts").glob("*/*/runtime/environment.json"))
        )
        == {}
    )
    arguments = json.loads(
        (
            next((tmp_path / "run/attempts").glob("*/*/runtime/arguments.json"))
        ).read_text()
    )
    assert arguments[arguments.index("--model") + 1] == "test/vision"
    assert "--no-extensions" in arguments and "--no-context-files" in arguments
    assert (
        arguments[arguments.index("--tools") + 1]
        == "annotation_view,annotation_preview,annotation_submit"
    )
    assert "--extension" in arguments
    with pytest.raises(FileExistsError):
        run_annotation(photo, tmp_path / "run", PiRuntime("test/vision", pi))


@pytest.mark.parametrize(
    ("model", "message"),
    [
        ("test/no-vision", "does not support image"),
        ("test/error", "assistant error"),
        ("test/invalid-stream", "Invalid Pi JSON"),
        ("test/incomplete", "complete"),
    ],
)
def test_errors_never_export_success(pi, photo, tmp_path, model, message):
    with pytest.raises((ValueError, RuntimeError), match=message):
        run_annotation(photo, tmp_path / "run", PiRuntime(model, pi))
    assert not (tmp_path / "run/result/result.json").exists()
    assert read_json(tmp_path / "run/status.json")["status"] == "failed"


def test_pi_stops_after_validated_submission_without_waiting_for_a_final_message(
    pi, photo, tmp_path
):
    report = run_annotation(photo, tmp_path / "run", PiRuntime("test/linger", pi, 5))
    assert report["execution"]["completedBySubmission"]
    assert read_json(tmp_path / "run/status.json")["status"] == "succeeded"
    assert read_json(tmp_path / "run/result/result.json")["coverage"]["fullImage"]


def test_timeout_and_cancellation_terminate_pi(pi, tmp_path):
    for name, timeout, cancel, exception in [
        ("timeout", 2, lambda: False, RuntimeError),
        (
            "cancel",
            30,
            lambda: (tmp_path / "cancel/pid").exists(),
            AgentInterruptedError,
        ),
    ]:
        directory = tmp_path / name
        with pytest.raises(exception):
            PiRuntime("test/wait", pi, timeout).execute(
                "unused",
                directory,
                descriptor={"runtime": "pi", "version": "test", "model": "test/wait"},
                cancelled=cancel,
                tools=ToolSet((), ()),
            )
        pid = int((directory / "pid").read_text())
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)


def test_pi_default_model_is_resolved_before_execution(pi):
    descriptor = PiRuntime(executable=pi).probe()
    assert descriptor == {
        "runtime": "pi",
        "version": "test-version",
        "model": "test/vision",
    }


def test_failed_pi_version_probe_is_an_execution_failure(photo, tmp_path):
    executable = tmp_path / "broken-pi"
    executable.write_text(f"#!{sys.executable}\nraise SystemExit(2)\n")
    executable.chmod(0o700)
    with pytest.raises(RuntimeError, match="version probe failed"):
        run_annotation(photo, tmp_path / "run", PiRuntime(executable=str(executable)))
    assert read_json(tmp_path / "run/status.json")["status"] == "failed"
