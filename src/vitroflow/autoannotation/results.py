"""Collect complete task responses into reusable source-coordinate results."""

from __future__ import annotations

from pathlib import Path

from vitroflow.autoannotation.geometry import (
    box_from_edges,
    clip,
    owned,
    rectangle,
    source_edges,
)
from vitroflow.autoannotation.protocol import (
    object_digest,
    validate_edges,
    validate_response,
)
from vitroflow.autoannotation.rendering import overlay
from vitroflow.autoannotation.storage import read_json, write_json
from vitroflow.autoannotation.tasks import (
    checkpoint,
    load_package,
    locked,
    outside_package,
)
from vitroflow.io.files import atomic_directory
from vitroflow.io.image_io import read_image


def seam_warnings(instances: list[dict]) -> list[dict]:
    warnings = []
    for index, a in enumerate(instances):
        for b in instances[index + 1 :]:
            if a["taskId"] == b["taskId"] or a["class"] != b["class"]:
                continue
            overlap = clip(rectangle(a["bbox"]), rectangle(b["bbox"]))
            area = max(0, overlap[2] - overlap[0]) * max(0, overlap[3] - overlap[1])
            smaller = min(v["bbox"]["width"] * v["bbox"]["height"] for v in (a, b))
            if area / smaller > 0.5:
                warnings.append(
                    {
                        "code": "possible-seam-duplicate",
                        "instanceIds": [a["id"], b["id"]],
                    }
                )
    return warnings


def collect(root: Path, destination: Path) -> dict:
    # Portable manual checkpoints are snapshotted before any expensive rendering.
    with locked(root):
        manifest = load_package(root)
        accepted = {}
        for task in manifest["tasks"]:
            state = checkpoint(root, manifest, task)
            if "response" in state:
                accepted[task["id"]] = state["response"]
    return collect_responses(root, destination, accepted)


def collect_responses(root: Path, destination: Path, accepted: dict[str, dict]) -> dict:
    outside_package(root, destination)
    manifest = load_package(root)
    source = manifest["source"]
    source_limits = [0, 0, source["width"], source["height"]]
    coverage = rectangle(manifest["coverage"]["bbox"])
    instances, issues, responses, revisions = [], [], [], {}
    for task in manifest["tasks"]:
        state = {"response": accepted[task["id"]]} if task["id"] in accepted else {}
        if "response" not in state:
            raise ValueError(f"Incomplete task: {task['id']}")
        response = state["response"]
        validate_response(response, manifest, task)
        validate_edges(response, manifest, task)
        revisions[task["id"]] = object_digest(state)
        responses.append(response)
        for item in response["instances"]:
            edges = source_edges(item, task)
            if not owned(edges, task["core"]):
                continue
            instances.append(
                {
                    **item,
                    "id": f"{task['id']}:{item['id']}",
                    "bbox": box_from_edges(edges),
                    "taskId": task["id"],
                    "producer": response["producer"],
                    "uncertain": item.get("uncertain", False),
                    "truncated": any(
                        abs(a - b) < 1e-6 for a, b in zip(edges, source_limits)
                    ),
                    "coverageTruncated": any(
                        abs(a - b) < 1e-6 for a, b in zip(edges, coverage)
                    ),
                    "localTruncated": item.get("truncated", False),
                }
            )
        issues.extend(
            {
                "taskId": task["id"],
                "bbox": box_from_edges(source_edges(v, task)),
                "reason": v["reason"],
            }
            for v in response["issues"]
        )
    warnings = seam_warnings(instances)
    output = {
        "schemaVersion": manifest["schemaVersion"],
        "kind": "ai-annotation-result",
        "packageId": manifest["packageId"],
        "checkpointDigests": revisions,
        "image": source,
        "coordinateSpace": "oriented source pixels",
        "coverage": manifest["coverage"],
        "instances": instances,
        "issues": issues,
        "warnings": warnings,
        "reviewStatus": "unreviewed",
        "qualityStatus": "needs-review"
        if issues
        or warnings
        or any(
            v["uncertain"] or v["coverageTruncated"] or v["localTruncated"]
            for v in instances
        )
        else "unverified",
        "inputDigest": manifest["assets"].get("input.json"),
    }
    before = []
    for item in read_json(root / "prelabels.json")["instances"]:
        edges = clip(rectangle(item["bbox"]), coverage)
        if edges[2] > edges[0] and edges[3] > edges[1]:
            before.append({**item, "bbox": box_from_edges(edges)})
    with atomic_directory(destination) as working:
        write_json(working / "result.json", output)
        write_json(working / "responses.json", {"responses": responses})
        if "input.json" in manifest["assets"]:
            write_json(working / "input.json", read_json(root / "input.json"))
        image = read_image(root / "coverage.png")
        origin = (coverage[0], coverage[1])
        overlay(working, "overlay", image, instances, origin)
        overlay(working, "before-overlay", image, before, origin)
    return {
        "count": len(instances),
        "warnings": len(warnings),
        "output": str(destination),
        "packageId": manifest["packageId"],
    }
