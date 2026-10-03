"""Collect complete task responses into reusable source-coordinate results."""

from __future__ import annotations

from pathlib import Path

from vitroflow.autoannotation.geometry import (
    box_from_edges,
    clip,
    cut,
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

# Overlap at which two regions' boxes are read as one object.
SAME_OBJECT_IOU = 0.5
# How a region read an object, strongest first: a box kept from the input, a box
# whose center lies in the reading tile's core, a whole box in its halo, and a
# box its patch edge cut.
STANDINGS = ("retained", "owned", "context", "partial")


def sighting(region: str, edges: list, standing: str, value: dict) -> dict:
    return {"region": region, "edges": edges, "standing": standing, "value": value}


def iou(a: list, b: list) -> float:
    shared = clip(a, b)
    area = max(0, shared[2] - shared[0]) * max(0, shared[3] - shared[1])
    if area == 0:
        return 0.0
    total = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1])
    return area / (total - area)


def same_objects(sightings: list[dict]) -> list[list[dict]]:
    """Group sightings of one object: one class, IoU at or above
    SAME_OBJECT_IOU, at most one per region, strongest overlaps first."""
    pairs = sorted(
        (-overlap, i, j)
        for i, a in enumerate(sightings)
        for j, b in enumerate(sightings[i + 1 :], i + 1)
        if a["region"] != b["region"]
        and a["value"].get("class") == b["value"].get("class")
        and (overlap := iou(a["edges"], b["edges"])) >= SAME_OBJECT_IOU
    )
    groups = [[i] for i in range(len(sightings))]
    group = list(range(len(sightings)))
    for _, i, j in pairs:
        into, source = group[i], group[j]
        if into == source:
            continue
        regions = {sightings[k]["region"] for k in groups[into]}
        if any(sightings[k]["region"] in regions for k in groups[source]):
            continue
        for k in groups[source]:
            group[k] = into
        groups[into] += groups[source]
        groups[source] = []
    return [
        [sightings[k] for k in sorted(members)]
        for members in sorted(filter(None, groups), key=min)
    ]


def objects(sightings: list[dict]) -> list[dict]:
    """The strongest sighting of each object, the first tile among equals; a
    lone halo sighting the owning tile did not confirm stands for nothing."""
    chosen = []
    for group in same_objects(sightings):
        best = min(group, key=lambda s: STANDINGS.index(s["standing"]))
        if len(group) > 1 or best["standing"] in ("retained", "owned"):
            chosen.append(best["value"])
    return chosen


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
    boxes, notes, responses, revisions = [], [], [], {}
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
            standing = (
                "owned"
                if owned(edges, task["core"])
                else "partial"
                if cut(edges, task["patch"], coverage)
                else "context"
            )
            boxes.append(
                sighting(
                    task["id"],
                    edges,
                    standing,
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
                    },
                )
            )
        for v in response["issues"]:
            edges = source_edges(v, task)
            notes.append(
                sighting(
                    task["id"],
                    edges,
                    "owned" if owned(edges, task["core"]) else "context",
                    {
                        "taskId": task["id"],
                        "bbox": box_from_edges(edges),
                        "reason": v["reason"],
                    },
                )
            )
    # Automatically omitted cores keep the input bodies rather than deleting them.
    originals = read_json(root / "prelabels.json")["instances"]

    def retained(box: dict) -> bool:
        edges = rectangle(box)
        return owned(edges, coverage) and not any(
            owned(edges, task["core"]) for task in manifest["tasks"]
        )

    def kept(value: dict) -> dict:
        return sighting("input", rectangle(value["bbox"]), "retained", value)

    for item in originals:
        if retained(item["bbox"]):
            boxes.append(
                kept(
                    {
                        **item,
                        "taskId": "input",
                        "producer": "input",
                        "uncertain": item.get("uncertain", False),
                        "truncated": False,
                        "coverageTruncated": False,
                        "localTruncated": False,
                    }
                )
            )
    if "input.json" in manifest["assets"]:
        previous = read_json(root / "input.json")
        for issue in previous.get("issues", []):
            if retained(issue["bbox"]):
                notes.append(
                    kept(
                        {
                            "taskId": "input",
                            "bbox": issue["bbox"],
                            "reason": issue["reason"],
                        }
                    )
                )
    instances = objects(boxes)
    issues = objects(notes)
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
        "reviewStatus": "unreviewed",
        "qualityStatus": "needs-review"
        if issues
        or any(
            v["uncertain"] or v["coverageTruncated"] or v["localTruncated"]
            for v in instances
        )
        else "unverified",
        "inputDigest": manifest["assets"].get("input.json"),
    }
    before = []
    for item in originals:
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
        "output": str(destination),
        "packageId": manifest["packageId"],
    }
