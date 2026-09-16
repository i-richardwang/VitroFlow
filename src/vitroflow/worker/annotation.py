"""Product transport for one external-agent image annotation assignment."""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from pathlib import Path

import httpx

from vitroflow.agent_annotation.runner import run_annotation
from vitroflow.agent_runtimes.contract import AgentInterruptedError, AgentRuntime
from vitroflow.autoannotation.storage import read_json, write_json
from vitroflow.contracts.validation import validate_wire_contract
from vitroflow.worker.session import LeaseLostError, WorkerClient, keep_lease

LOGGER = logging.getLogger(__name__)


class AnnotationClient:
    def __init__(self, client: WorkerClient) -> None:
        self.client = client

    def claim(self) -> dict | None:
        response = self.client.request(
            "POST", "api/worker/annotation/claim", json=self.client.identity
        )
        self.client.require_current_session(response)
        assignment = response.json()["run"]
        if assignment is not None:
            validate_wire_contract(
                "annotation-assignment", assignment, "AI annotation assignment"
            )
        return assignment

    def update(self, identifier: str, operation: str, **values) -> None:
        response = self.client.request(
            "POST",
            f"api/worker/annotation/runs/{identifier}/{operation}",
            json={**self.client.identity, "operation": operation, **values},
        )
        self.client.require_current_session(response)


def product_result(assignment: dict, directory: Path) -> dict:
    document = read_json(directory / "result" / "result.json")
    image = assignment["image"]
    source = document["image"]
    if (
        source["sha256"] != image["digest"]
        or [source["width"], source["height"]] != [image["width"], image["height"]]
        or not document["coverage"]["fullImage"]
    ):
        raise ValueError("AI result must cover the exact product image")
    execution = read_json(directory / "execution.json")
    result = {
        "document": {
            "schemaVersion": 1,
            "image": image,
            "instances": [
                {key: item[key] for key in ("id", "class", "bbox")}
                for item in document["instances"]
            ],
        },
        "packageId": document["packageId"],
        "checkpointDigests": document["checkpointDigests"],
        "issues": [
            {key: issue[key] for key in ("bbox", "reason")}
            for issue in document["issues"]
        ],
        "warnings": [
            json.dumps(warning, sort_keys=True) for warning in document["warnings"]
        ],
        "uncertainIds": [
            item["id"]
            for item in document["instances"]
            if any(
                item.get(key)
                for key in (
                    "uncertain",
                    "truncated",
                    "coverageTruncated",
                    "localTruncated",
                )
            )
        ],
        "execution": {
            key: execution[key]
            for key in ("runtime", "version", "model", "elapsedSeconds")
        },
    }
    validate_wire_contract("annotation-run-result", result, "AI annotation result")
    return result


def process_annotation_job(
    client: AnnotationClient,
    assignment: dict,
    work_dir: Path,
    runtime: AgentRuntime,
    *,
    stopped: threading.Event,
) -> None:
    identifier = assignment["id"]
    directory = work_dir / "annotations" / identifier
    with keep_lease(
        client.client,
        lambda: client.update(identifier, "lease"),
        cancelled=stopped.is_set,
    ) as cancelled:
        result_file = directory / "product-result.json"
        if result_file.is_file():
            client.update(identifier, "complete", result=read_json(result_file))
            return
        try:
            if directory.exists():
                raise RuntimeError("Unfinished local AI run; start a new run to retry")
            directory.mkdir(parents=True, mode=0o700)
            response = client.client.request(
                "GET",
                f"api/worker/annotation/runs/{identifier}/image",
                params=client.client.identity,
            )
            client.client.require_current_session(response)
            if (
                hashlib.sha256(response.content).hexdigest()
                != assignment["image"]["digest"]
            ):
                raise ValueError("Downloaded image digest mismatch")
            source = directory / "image.avif"
            source.write_bytes(response.content)
            prelabels = None
            if assignment["input"] is not None:
                prelabels = directory / "input.json"
                write_json(
                    prelabels,
                    {
                        "image": {
                            "sha256": assignment["image"]["digest"],
                            "width": assignment["image"]["width"],
                            "height": assignment["image"]["height"],
                        },
                        "instances": assignment["input"],
                    },
                )

            def report_progress(done: int, total: int) -> None:
                try:
                    client.update(
                        identifier,
                        "progress",
                        progress={"completed": done, "total": total},
                    )
                except httpx.HTTPError as error:
                    LOGGER.warning("Could not report AI annotation progress: %s", error)

            run_annotation(
                source,
                directory / "execution",
                runtime,
                prelabels=prelabels,
                config=assignment["config"],
                cancelled=cancelled,
                progress=report_progress,
            )
            if cancelled():
                raise AgentInterruptedError("AI annotation cancelled")
            result = product_result(assignment, directory / "execution")
            write_json(result_file, result)
        except LeaseLostError:
            raise
        except (OSError, ValueError, RuntimeError, httpx.HTTPError):
            if not stopped.is_set():
                client.update(
                    identifier,
                    "fail",
                    error="AI annotation execution failed. Inspect the Worker logs before starting a new run.",
                )
            raise
        # Delivery retries reuse the durable result without rerunning the agent.
        client.update(identifier, "complete", result=result)
