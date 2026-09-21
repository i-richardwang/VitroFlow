"""Ownership, durable acceptance and isolated execution under real concurrency."""

import base64
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
import pytest

from vitroflow.agent_annotation.coordinator import Coordinator, request
from vitroflow.agent_annotation.runner import recover_annotation, run_annotation
from vitroflow.agent_annotation.tools import AnnotationTools
from vitroflow.autoannotation.preparation import prepare
from vitroflow.autoannotation.storage import read_json, write_json


def fixture_image(tmp_path, width=160, height=80):
    image = tmp_path / "photo.png"
    cv2.imwrite(
        str(image),
        np.arange(width * height * 3, dtype=np.uint8).reshape(height, width, 3),
    )
    return image


def tool_for(coordinator, task_id):
    attempt = coordinator.command("start", taskId=task_id, producer="test/vision")
    return attempt, AnnotationTools(Path(attempt["directory"]) / "tools/config.json")


def proposal(tools):
    result = tools.call(
        "annotation_preview", {"taskId": tools.task["id"], "instances": []}
    )
    return {
        "taskId": tools.task["id"],
        "proposalId": json.loads(result["content"][0]["text"])["proposalId"],
    }


def test_slow_preview_does_not_block_acceptance_or_status(tmp_path, monkeypatch):
    package = tmp_path / "inputs"
    prepare(fixture_image(tmp_path), package, config={"coreSize": 80, "halo": 0})
    entered, release = threading.Event(), threading.Event()
    from vitroflow.agent_annotation import tools as module

    original = module.render_preview

    def slow(root, task, value, destination):
        if task["id"] == "tile-000-001":
            entered.set()
            assert release.wait(5)
        return original(root, task, value, destination)

    monkeypatch.setattr(module, "render_preview", slow)
    with Coordinator(tmp_path / "run", package) as owner:
        _, first = tool_for(owner, "tile-000-000")
        _, second = tool_for(owner, "tile-000-001")
        value = proposal(first)
        with ThreadPoolExecutor() as pool:
            future = pool.submit(proposal, second)
            try:
                assert entered.wait(3)
                assert first.call("annotation_submit", value)["complete"]
                assert owner.snapshot()["tasks"]["tile-000-000"]["state"] == "accepted"
                assert not future.done()
            finally:
                release.set()
            future.result()


def test_duplicate_acceptance_stale_attempt_cancel_and_restart(tmp_path):
    package = tmp_path / "inputs"
    prepare(fixture_image(tmp_path), package, config={"coreSize": 80, "halo": 0})
    directory = tmp_path / "run"
    with Coordinator(directory, package) as owner:
        old, old_tools = tool_for(owner, "tile-000-000")
        old_value = proposal(old_tools)
        owner.command(
            "fail",
            taskId=old["taskId"],
            attemptId=old["attemptId"],
            error="interrupted",
        )
        current, tools = tool_for(owner, old["taskId"])
        assert old["attemptId"] != current["attemptId"]
        with pytest.raises(ValueError, match="Stale"):
            old_tools.call("annotation_submit", old_value)
        value = proposal(tools)
        with ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(
                pool.map(lambda _: tools.call("annotation_submit", value), range(8))
            )
        assert all(r == replies[0] for r in replies)
        assert owner.events[old["taskId"]].is_set()
        second, other = tool_for(owner, "tile-000-001")
        other_value = proposal(other)
        owner.stop()
        with pytest.raises(ValueError, match="no longer active"):
            other.call("annotation_submit", other_value)
    with Coordinator(directory, package) as recovered:
        assert recovered.events[old["taskId"]].is_set()
        assert not recovered.events[second["taskId"]].is_set()
        assert (
            recovered.snapshot()["tasks"][old["taskId"]]["proposalId"]
            == value["proposalId"]
        )
        replacement, _ = tool_for(recovered, second["taskId"])
        with pytest.raises(ValueError, match="Stale"):
            request(
                recovered.endpoint,
                {
                    "operation": "submit",
                    "taskId": second["taskId"],
                    "attemptId": second["attemptId"],
                    "proposalId": other_value["proposalId"],
                },
            )
        assert replacement["attemptId"] != second["attemptId"]


def test_only_one_owner_and_task_scoped_tools(tmp_path):
    package = tmp_path / "inputs"
    prepare(fixture_image(tmp_path), package, config={"coreSize": 80})
    with Coordinator(tmp_path / "run", package) as owner:
        with (
            pytest.raises(RuntimeError, match="active coordinator"),
            Coordinator(tmp_path / "run", package),
        ):
            pytest.fail("two writers acquired the same run")
        _, tools = tool_for(owner, "tile-000-000")
        for operation in ("annotation_view", "annotation_preview"):
            args = {"taskId": "tile-000-001"}
            if operation.endswith("preview"):
                args["instances"] = []
            with pytest.raises(ValueError, match="different task"):
                tools.call(operation, args)
        assert not (package / ".lock").exists()


def test_corrupt_proposal_and_failed_durable_write_never_acknowledged(
    tmp_path, monkeypatch
):
    package = tmp_path / "inputs"
    prepare(fixture_image(tmp_path), package)
    with Coordinator(tmp_path / "run", package) as owner:
        _, tools = tool_for(owner, "tile-000-000")
        value = proposal(tools)
        path = tools.directory / "proposals" / f"{value['proposalId']}.json"
        original = read_json(path)
        write_json(path, {**original, "producer": "tampered"})
        with pytest.raises(ValueError, match="digest mismatch"):
            tools.call("annotation_submit", value)
        write_json(path, original)
        from vitroflow.agent_annotation import coordinator as module

        write = module.write_json

        def unavailable(path, data):
            if path.name == "state.json":
                raise OSError("storage unavailable")
            return write(path, data)

        with monkeypatch.context() as patch:
            patch.setattr(module, "write_json", unavailable)
            with pytest.raises(ValueError, match="storage unavailable"):
                tools.call("annotation_submit", value)
        assert not owner.events[tools.task["id"]].is_set()
        assert owner.snapshot()["tasks"][tools.task["id"]]["state"] == "running"
        assert tools.call("annotation_submit", value)["complete"]


class FakeRuntime:
    def __init__(self, fail=None, barrier=None, crash_after_submit=False):
        self.fail = fail
        self.barrier = barrier
        self.crash_after_submit = crash_after_submit
        self.calls = []
        self.probes = 0

    def probe(self):
        self.probes += 1
        return {"runtime": "test", "version": "1", "model": "vision"}

    def execute(self, prompt, directory, *, descriptor, tools, cancelled, completed):
        directory.mkdir(parents=True)
        tool = AnnotationTools(Path(tools.command[tools.command.index("--config") + 1]))
        task_id = tool.task["id"]
        self.calls.append((task_id, tool.settings["attemptId"]))
        assert json.loads(prompt.split("Assigned task: ")[1].split(".\n")[0]) == task_id
        assert {t["name"] for t in tools.definitions} == {
            "annotation_view",
            "annotation_preview",
            "annotation_submit",
        }
        if self.barrier:
            self.barrier.wait(timeout=5)
        if task_id == self.fail:
            raise RuntimeError("simulated task failure")
        if cancelled():
            raise RuntimeError("cancelled")
        tool.call("annotation_view", {"taskId": task_id})
        tool.call("annotation_submit", proposal(tool))
        assert completed()
        if self.crash_after_submit:
            raise RuntimeError("lost runtime reply after durable submission")
        return {**descriptor, "completedBySubmission": True, "elapsedSeconds": 0.01}


def test_parallel_sessions_and_explicit_resume_only_unfinished_tiles(tmp_path):
    image = fixture_image(tmp_path)
    config = {"coreSize": 80, "halo": 0}
    first = FakeRuntime(fail="tile-000-001")
    progress = []
    with pytest.raises(RuntimeError, match="simulated"):
        run_annotation(
            image,
            tmp_path / "run",
            first,
            config=config,
            max_parallel=1,
            progress=lambda a, b: progress.append(a),
        )
    assert [t for t, _ in first.calls] == ["tile-000-000", "tile-000-001"]
    before = read_json(tmp_path / "run/state.json")
    with pytest.raises(RuntimeError, match="Unfinished local AI run"):
        recover_annotation(image, tmp_path / "run", config=config)
    assert read_json(tmp_path / "run/state.json") == before
    second = FakeRuntime()
    report = run_annotation(image, tmp_path / "run", second, config=config, resume=True)
    assert [t for t, _ in second.calls] == ["tile-000-001"]
    assert first.calls[-1][1] != second.calls[0][1]
    assert len(report["execution"]["tasks"]) == 2
    assert read_json(tmp_path / "run/result/result.json")["instances"] == []
    third = FakeRuntime()
    run_annotation(image, tmp_path / "run", third, config=config, resume=True)
    assert third.calls == [] and third.probes == 0
    recovered = recover_annotation(image, tmp_path / "run", config=config)
    assert recovered == report
    with pytest.raises(ValueError, match="original image, input and settings"):
        run_annotation(
            image, tmp_path / "run", FakeRuntime(), config={"halo": 4}, resume=True
        )
    assert read_json(tmp_path / "run/status.json") == {"status": "succeeded"}
    concurrent = FakeRuntime(barrier=threading.Barrier(2), crash_after_submit=True)
    run_annotation(
        image, tmp_path / "parallel", concurrent, config=config, max_parallel=2
    )
    assert len(concurrent.calls) == 2
    assert len({a for _, a in concurrent.calls}) == 2
    assert not (tmp_path / "parallel/tasks/.lock").exists()


def test_failure_stops_dispatch_while_running_sessions_finish(tmp_path):
    image = fixture_image(tmp_path, 240, 80)
    config = {"coreSize": 80, "halo": 0}
    runtime = FakeRuntime(fail="tile-000-000", barrier=threading.Barrier(2))
    with pytest.raises(RuntimeError, match="simulated"):
        run_annotation(image, tmp_path / "run", runtime, config=config, max_parallel=2)
    state = read_json(tmp_path / "run/state.json")["tasks"]
    assert state["tile-000-000"]["state"] == "failed"
    assert state["tile-000-000"]["error"] == "simulated task failure"
    assert state["tile-000-001"]["state"] == "accepted"
    assert "tile-000-002" not in state
    resumed = FakeRuntime()
    run_annotation(image, tmp_path / "run", resumed, config=config, resume=True)
    assert {t for t, _ in resumed.calls} == {"tile-000-000", "tile-000-002"}


def test_cancellation_fences_publication_and_does_not_export(tmp_path):
    image = fixture_image(tmp_path)
    stop = threading.Event()

    class CancelRuntime(FakeRuntime):
        def execute(self, prompt, directory, *, tools, cancelled, **kwargs):
            stop.set()
            while not cancelled():
                threading.Event().wait(0.005)
            # A submission that arrives after cancellation is refused.
            tool = AnnotationTools(
                Path(tools.command[tools.command.index("--config") + 1])
            )
            with pytest.raises(ValueError, match="no longer active"):
                tool.call("annotation_submit", proposal(tool))
            raise RuntimeError("cancelled tile")

    with pytest.raises(RuntimeError, match="cancelled"):
        run_annotation(image, tmp_path / "run", CancelRuntime(), cancelled=stop.is_set)
    assert not (tmp_path / "run/result").exists()
    assert all(
        v["state"] != "accepted"
        for v in read_json(tmp_path / "run/state.json")["tasks"].values()
    )


def test_overview_is_full_image_and_locator_matches_halo_without_changing_clean(
    tmp_path, annotation_attempt
):
    image = fixture_image(tmp_path, 1200, 800)
    package = tmp_path / "inputs"
    prepare(
        image, package, crop=[600, 400, 256, 256], config={"coreSize": 128, "halo": 32}
    )
    owner, config = annotation_attempt(package, task_id="tile-001-001")
    tools = AnnotationTools(config)
    viewed = tools.call("annotation_view", {"taskId": tools.task["id"]})
    images = [
        cv2.imdecode(np.frombuffer(base64.b64decode(v["data"]), np.uint8), 1)
        for v in viewed["content"]
        if v["type"] == "image"
    ]
    original = cv2.imread(str(image))
    assert np.array_equal(images[1], original[496:656, 696:856])
    expected = cv2.resize(original, (1024, 683), interpolation=cv2.INTER_AREA)
    cv2.rectangle(
        expected,
        (round(696 * 1024 / 1200), round(496 * 1024 / 1200)),
        (round(856 * 1024 / 1200), round(656 * 1024 / 1200)),
        (20, 50, 255),
        3,
    )
    assert np.array_equal(images[0], expected)
    assert len(owner.events) == 4


def test_directory_sync_failure_replay_finishes_durable_acceptance(
    tmp_path, monkeypatch
):
    import os
    import stat

    package = tmp_path / "inputs"
    prepare(fixture_image(tmp_path), package)
    with Coordinator(tmp_path / "run", package) as owner:
        _, tools = tool_for(owner, "tile-000-000")
        value = proposal(tools)
        original = os.fsync
        failed = False

        def sync(descriptor):
            nonlocal failed
            if stat.S_ISDIR(os.fstat(descriptor).st_mode) and not failed:
                failed = True
                raise OSError("directory sync failed")
            return original(descriptor)

        with monkeypatch.context() as patch:
            patch.setattr(os, "fsync", sync)
            with pytest.raises(ValueError, match="directory sync failed"):
                tools.call("annotation_submit", value)
            assert not owner.events[tools.task["id"]].is_set()
            # The renamed file is visible, but the caller has not received an ack.
            assert owner.snapshot()["tasks"][tools.task["id"]]["state"] == "accepted"
            assert tools.call("annotation_submit", value)["complete"]
            assert owner.events[tools.task["id"]].is_set()
