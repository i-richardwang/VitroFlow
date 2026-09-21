"""Wire contract and validation for visual annotation inputs and responses."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from vitroflow.autoannotation.geometry import owned, rectangle, source_edges

SCHEMA_VERSION = "vitroflow.autoannotation/v5"


def encoded(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        + "\n"
    ).encode()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def object_digest(value: Any) -> str:
    return digest(encoded(value))


def fields(value: Any, required: set[str], optional: set[str] | None = None) -> None:
    if (
        not isinstance(value, dict)
        or not required <= value.keys()
        or value.keys() - required - (optional or set())
    ):
        raise ValueError(
            f"Expected fields {sorted(required)}; optional {sorted(optional or set())}"
        )


def nonempty(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a nonempty string")
    return value


def instances(value: Any, size: list[int], classes: list[str]) -> list[dict]:
    if not isinstance(value, list):
        raise TypeError("instances must be a list")
    seen = set()
    for item in value:
        fields(item, {"id", "class", "bbox"}, {"uncertain", "truncated"})
        identifier = nonempty(item["id"], "instance id")
        if identifier in seen or item["class"] not in classes:
            raise ValueError("Duplicate instance id or unsupported class")
        seen.add(identifier)
        for flag in ("uncertain", "truncated"):
            if flag in item and not isinstance(item[flag], bool):
                raise ValueError(f"{flag} must be boolean")
        validate_box(item["bbox"], size)
    return value


def validate_box(box: Any, size: list[int]) -> None:
    fields(box, {"x", "y", "width", "height"})
    if any(
        isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v)
        for v in box.values()
    ):
        raise ValueError("Bounding box coordinates must be finite numbers")
    x, y, w, h = (box[k] for k in ("x", "y", "width", "height"))
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > size[0] or y + h > size[1]:
        raise ValueError("Bounding box outside image or nonpositive size")


def validate_response(value: dict, manifest: dict, task: dict) -> None:
    fields(
        value,
        {
            "schemaVersion",
            "packageId",
            "taskId",
            "producer",
            "instances",
            "issues",
        },
    )
    for key, expected in (
        ("schemaVersion", SCHEMA_VERSION),
        ("packageId", manifest["packageId"]),
        ("taskId", task["id"]),
    ):
        if value[key] != expected:
            raise ValueError(f"Annotation response {key} does not match task")
    nonempty(value["producer"], "producer")
    instances(value["instances"], task["displaySize"], manifest["config"]["classes"])
    validate_issues(value["issues"], task)


def validate_issues(issues: list, task: dict) -> None:
    if not isinstance(issues, list):
        raise TypeError("issues must be a list")
    for issue in issues:
        fields(issue, {"bbox", "reason"})
        nonempty(issue["reason"], "issue reason")
        validate_box(issue["bbox"], task["displaySize"])


def candidates(supplied: dict, source: dict, classes: list[str]) -> list[dict]:
    """Read plain prelabels or exported results; strip export-only metadata explicitly."""
    if isinstance(supplied, dict) and supplied.get("kind") == "ai-annotation-result":
        if (
            supplied.get("schemaVersion") != SCHEMA_VERSION
            or supplied.get("coordinateSpace") != "oriented source pixels"
        ):
            raise ValueError(
                "Unsupported annotation result version or coordinate space"
            )
        image = supplied.get("image")
        if not isinstance(image, dict) or {k: image.get(k) for k in source} != source:
            raise ValueError("Prelabel image identity/size must match oriented source")
        raw = supplied.get("instances")
        if not isinstance(raw, list) or any(not isinstance(v, dict) for v in raw):
            raise ValueError("Result instances must be a list of objects")
        # Source/coverage/local truncation flags describe the previous run's
        # geometry. They must be recomputed for this run, not copied as local flags.
        values = [
            {k: v[k] for k in ("id", "class", "bbox", "uncertain") if k in v}
            for v in raw
        ]
    else:
        fields(supplied, {"image", "instances"})
        if supplied["image"] != source:
            raise ValueError("Prelabel image identity/size must match oriented source")
        values = supplied["instances"]
    return instances(values, [source["width"], source["height"]], classes)


def validate_edges(value: dict, manifest: dict, task: dict) -> None:
    coverage = rectangle(manifest["coverage"]["bbox"])
    for item in value["instances"]:
        edges = source_edges(item, task)
        if owned(edges, task["core"]) and any(
            abs(edges[i] - task["patch"][i]) < 1e-6 and task["patch"][i] != coverage[i]
            for i in range(4)
        ):
            raise ValueError(
                "Owned box touches internal patch edge; prepare more halo/larger tiles"
            )
