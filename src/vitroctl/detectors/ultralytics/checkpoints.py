"""The portable Ultralytics checkpoint: resumable weights and their epoch journal."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

EPOCH_JOURNAL = "epochs.jsonl"
CHECKPOINT_FILES = ("weights/last.pt", "weights/best.pt", EPOCH_JOURNAL)
MAX_CHECKPOINT_BYTES = 512 * 1024**2


def pack_checkpoint(output: Path) -> bytes:
    if (
        sum((output / name).stat().st_size for name in CHECKPOINT_FILES)
        > MAX_CHECKPOINT_BYTES
    ):
        raise ValueError("Training checkpoint is too large")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in CHECKPOINT_FILES:
            archive.write(output / name, name)
    payload = buffer.getvalue()
    if len(payload) > MAX_CHECKPOINT_BYTES:
        raise ValueError("Training checkpoint is too large")
    return payload


def unpack_checkpoint(payload: bytes, output: Path) -> None:
    if len(payload) > MAX_CHECKPOINT_BYTES:
        raise ValueError("Training checkpoint is too large")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if sorted(archive.namelist()) != sorted(CHECKPOINT_FILES):
            raise ValueError("Invalid training checkpoint files")
        if sum(entry.file_size for entry in archive.infolist()) > MAX_CHECKPOINT_BYTES:
            raise ValueError("Training checkpoint is too large")
        for name in CHECKPOINT_FILES:
            target = output / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
