from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from vitroctl.detectors.ultralytics.checkpoints import (
    CHECKPOINT_FILES,
    unpack_checkpoint,
)


@pytest.mark.parametrize("extra", ["../outside.pt", "weights/last.pt"])
def test_checkpoint_rejects_unexpected_or_duplicate_members(
    tmp_path: Path,
    extra: str,
) -> None:
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        for name in CHECKPOINT_FILES:
            archive.writestr(name, b"checkpoint")
        if extra in CHECKPOINT_FILES:
            with pytest.warns(UserWarning, match="Duplicate name"):
                archive.writestr(extra, b"other")
        else:
            archive.writestr(extra, b"other")
    output = tmp_path / "restore"
    with pytest.raises(ValueError, match="Invalid training checkpoint files"):
        unpack_checkpoint(payload.getvalue(), output)
    assert not output.exists()
