"""Plan and freeze native-resolution images and editable input candidates."""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

from vitroflow.autoannotation.geometry import box_from_edges, clip, rectangle
from vitroflow.autoannotation.instructions import INSTRUCTIONS
from vitroflow.autoannotation.protocol import (
    SCHEMA_VERSION,
    candidates,
    digest,
    nonempty,
    object_digest,
)
from vitroflow.autoannotation.rendering import draw, references
from vitroflow.autoannotation.storage import read_json, write_image, write_json
from vitroflow.contracts.validation import contract_defaults, validate_wire_contract
from vitroflow.io.files import atomic_directory
from vitroflow.io.image_io import MAX_IMAGE_BYTES


def prepare(
    image_path: Path,
    destination: Path | None,
    *,
    crop: list[int] | None = None,
    prelabels_path: Path | None = None,
    config: dict | None = None,
    plan_only: bool = False,
) -> dict:
    config = config or {}
    defaults = contract_defaults("annotation-config")
    settings = {**defaults, **config}
    validate_wire_contract("annotation-config", settings, "annotation config")
    for key in ("coreSize", "halo", "displayScale"):
        settings[key] = int(settings[key])
    nonempty(settings["rules"], "rules")
    if settings["halo"] > settings["coreSize"]:
        raise ValueError("halo cannot exceed coreSize")
    classes = settings["classes"]
    if classes != defaults["classes"] and "rules" not in config:
        raise ValueError("Custom classes require explicit rules")
    if image_path.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError("Image exceeds 64 MiB")
    source_bytes = image_path.read_bytes()
    # Decode the same bytes we identify. OpenCV's default color decoder applies
    # EXIF orientation. Freeze the oriented pixels as PNG for all tasks.
    image = cv2.imdecode(np.frombuffer(source_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode source image")
    height, width = image.shape[:2]
    crop = crop if crop is not None else [0, 0, width, height]
    if len(crop) != 4 or any(
        isinstance(n, bool) or not isinstance(n, int) for n in crop
    ):
        raise ValueError("crop requires four integers: x y width height")
    x, y, w, h = crop
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
        raise ValueError("Crop outside oriented source image")
    source = {"sha256": digest(source_bytes), "width": width, "height": height}
    columns, rows = (
        math.ceil(w / settings["coreSize"]),
        math.ceil(h / settings["coreSize"]),
    )
    workload = {
        "sourceSize": [width, height],
        "coverageBbox": {"x": x, "y": y, "width": w, "height": h},
        "coveragePercent": 100 * w * h / (width * height),
        "grid": [columns, rows],
        "taskCount": columns * rows,
        "coreSize": settings["coreSize"],
        "halo": settings["halo"],
        "displayScale": settings["displayScale"],
        "maxTileDisplaySize": [
            max(
                min(size, start + settings["coreSize"] + settings["halo"])
                - max(0, start - settings["halo"])
                for start in range(0, size, settings["coreSize"])
            )
            * settings["displayScale"]
            for size in (w, h)
        ],
        "minimumSubmissions": columns * rows,
        "sessionsAndToolCalls": "Chosen by executor; task count is not session or API call count",
    }
    originals = []
    supplied = None
    if prelabels_path:
        supplied = read_json(prelabels_path)
        originals = candidates(supplied, source, classes)
    if plan_only:
        return workload
    if destination is None:
        raise ValueError("prepare requires a destination")
    roi = [x, y, x + w, y + h]
    with atomic_directory(destination) as root:
        write_image(root / "source.png", image)
        write_image(root / "coverage.png", image[y : y + h, x : x + w])
        (root / "INSTRUCTIONS.md").write_text(INSTRUCTIONS, encoding="utf-8")
        write_json(root / "prelabels.json", {"image": source, "instances": originals})
        if supplied is not None:
            # Frozen original input preserves round provenance and unresolved
            # issues without treating prior explanations as visual evidence.
            write_json(root / "input.json", supplied)
        # Global location evidence is frozen once. Each patch has its own locator;
        # CLEAN remains at its configured native scale, including halo.
        overview_scale = min(1.0, 1024 / max(width, height))
        overview_size = (
            max(1, round(width * overview_scale)),
            max(1, round(height * overview_scale)),
        )
        overview = cv2.resize(image, overview_size, interpolation=cv2.INTER_AREA)
        tasks = []
        core_size, halo, scale = (
            settings[k] for k in ("coreSize", "halo", "displayScale")
        )
        for row, top in enumerate(range(y, y + h, core_size)):
            for col, left in enumerate(range(x, x + w, core_size)):
                core = [
                    left,
                    top,
                    min(left + core_size, x + w),
                    min(top + core_size, y + h),
                ]
                patch = [
                    max(x, left - halo),
                    max(y, top - halo),
                    min(x + w, core[2] + halo),
                    min(y + h, core[3] + halo),
                ]
                identifier = f"tile-{row:03d}-{col:03d}"
                folder = root / "tasks" / identifier
                folder.mkdir(parents=True)
                display = [(patch[2] - patch[0]) * scale, (patch[3] - patch[1]) * scale]
                task = {
                    "id": identifier,
                    "core": core,
                    "patch": patch,
                    "displaySize": display,
                    "displayScale": scale,
                    "coordinateSpace": "clean.png display pixels",
                }
                context = overview.copy()
                cv2.rectangle(
                    context,
                    (
                        round(patch[0] * overview_scale),
                        round(patch[1] * overview_scale),
                    ),
                    (
                        min(overview_size[0] - 1, round(patch[2] * overview_scale)),
                        min(overview_size[1] - 1, round(patch[3] * overview_scale)),
                    ),
                    (20, 50, 255),
                    3,
                )
                write_image(folder / "overview.png", context)
                write_json(folder / "task.json", task)
                patch_image = image[patch[1] : patch[3], patch[0] : patch[2]]
                clean = (
                    patch_image
                    if scale == 1
                    else cv2.resize(
                        patch_image, tuple(display), interpolation=cv2.INTER_CUBIC
                    )
                )
                write_image(folder / "clean.png", clean)
                local = []
                for item in originals:
                    edges = clip(rectangle(item["bbox"]), patch)
                    if edges[2] <= edges[0] or edges[3] <= edges[1]:
                        continue
                    displayed = [(edges[i] - patch[i % 2]) * scale for i in range(4)]
                    local.append(
                        {
                            "id": item["id"],
                            "class": item["class"],
                            "bbox": box_from_edges(displayed),
                            "clipped": edges != rectangle(item["bbox"]),
                        }
                    )
                write_json(folder / "prelabels.json", {"instances": local})
                if local:
                    write_image(folder / "before.png", draw(clean, references(local)))
                tasks.append(task)
        assets = {
            str(p.relative_to(root)): digest(p.read_bytes())
            for p in sorted(root.rglob("*"))
            if p.is_file()
        }
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "source": {
                **source,
                "normalizedSha256": assets["source.png"],
                "decoder": f"opencv/{cv2.__version__}/IMREAD_COLOR-exif",
            },
            "coverage": {
                "bbox": box_from_edges(roi),
                "fullImage": crop == [0, 0, width, height],
            },
            "config": settings,
            "tasks": tasks,
            "assets": assets,
        }
        manifest["packageId"] = object_digest(manifest)
        write_json(root / "manifest.json", manifest)
    return {
        "packageId": manifest["packageId"],
        "taskCount": len(tasks),
        "run": str(destination),
        "workload": workload,
    }
