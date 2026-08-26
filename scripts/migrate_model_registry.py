from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

DEFAULT_MODEL_ID = "seed-detector"


def _read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"{path} must contain an object")
    return value


def _write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def _producers(
    data_root: Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, set[str]]]:
    descriptors: dict[str, dict[str, Any]] = {}
    by_dataset: dict[str, set[str]] = {}
    for path in sorted((data_root / "prelabels").glob("*/*.json")):
        producer = _read(path).get("producer")
        if not isinstance(producer, dict) or not isinstance(
            producer.get("version_id"), str
        ):
            raise TypeError(f"{path} has no valid producer")
        version_id = producer["version_id"]
        if version_id in descriptors and descriptors[version_id] != producer:
            raise ValueError(
                f"Prelabeler version {version_id} has conflicting contents"
            )
        descriptors[version_id] = producer
        by_dataset.setdefault(path.parent.name, set()).add(version_id)
    return descriptors, by_dataset


def migrate(data_root: Path, backup: Path) -> None:
    if backup.exists():
        raise FileExistsError(f"Backup already exists: {backup}")
    backup.mkdir(parents=True)
    for name in ("datasets", "workers", "prelabelers", "models", "model-versions"):
        source = data_root / name
        if source.exists():
            shutil.copytree(source, backup / name)

    descriptors, versions_by_dataset = _producers(data_root)
    legacy_registry = data_root / "prelabelers"
    if legacy_registry.exists():
        for path in sorted(legacy_registry.glob("*.json")):
            descriptor = _read(path).get("descriptor")
            if not isinstance(descriptor, dict) or not isinstance(
                descriptor.get("version_id"), str
            ):
                raise TypeError(f"{path} has no valid descriptor")
            version_id = descriptor["version_id"]
            if version_id in descriptors and descriptors[version_id] != descriptor:
                raise ValueError(
                    f"Prelabeler version {version_id} has conflicting contents"
                )
            descriptors[version_id] = descriptor

    _write(
        data_root / "models" / f"{DEFAULT_MODEL_ID}.json",
        {
            "schemaVersion": 1,
            "id": DEFAULT_MODEL_ID,
            "name": "Seed detector",
            "task": "object_detection",
            "classes": ["seed"],
        },
    )
    for version_id, descriptor in sorted(descriptors.items()):
        _write(
            data_root / "model-versions" / f"{version_id}.json",
            {
                "schemaVersion": 1,
                "id": version_id,
                "modelId": DEFAULT_MODEL_ID,
                "prelabeler": descriptor,
            },
        )

    for path in sorted((data_root / "datasets").glob("*.json")):
        dataset = _read(path)
        if dataset.get("schemaVersion") != 1 or dataset.get("id") != path.stem:
            raise ValueError(f"Unsupported dataset record: {path}")
        versions = versions_by_dataset.get(path.stem, set())
        selected = (
            next(iter(versions))
            if len(versions) == 1
            else dataset.get("selectedModelVersionId")
            or dataset.get("selectedPrelabelerVersionId")
            or "traditional-v1"
        )
        _write(
            path,
            {
                "schemaVersion": 1,
                "id": path.stem,
                "modelId": DEFAULT_MODEL_ID,
                "selectedModelVersionId": selected,
            },
        )

    workers = data_root / "workers"
    if workers.exists():
        for path in sorted(workers.glob("*.json")):
            worker = _read(path)
            if "prelabeler" not in worker:
                path.unlink()
                continue
            worker["modelId"] = DEFAULT_MODEL_ID
            _write(path, worker)

    if legacy_registry.exists():
        shutil.rmtree(legacy_registry)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migrate VitroFlow executable versions into the Model registry."
    )
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    data_root = args.data_root.resolve()
    backup = (
        args.backup.resolve()
        if args.backup
        else data_root / ".migration-backup-model-registry"
    )
    migrate(data_root, backup)
    print(f"Migrated {data_root}; backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
