from pathlib import Path

from vitroflow.detectors.traditional.detector import TraditionalDetector
from vitroflow.detectors.traditional.identity import pipeline_fingerprint
from vitroflow.io import image_io


def test_runtime_identity_covers_image_decoding_without_changing_artifact_identity(
    monkeypatch,
) -> None:
    pipeline_fingerprint.cache_clear()
    detector = TraditionalDetector()
    before = detector.runtime
    artifact = detector.artifact_digest
    image_source = Path(image_io.__file__).resolve()
    read_bytes = Path.read_bytes

    def changed_source(path: Path) -> bytes:
        content = read_bytes(path)
        return (
            content + b"\n# decoder changed\n"
            if path.resolve() == image_source
            else content
        )

    monkeypatch.setattr(Path, "read_bytes", changed_source)
    pipeline_fingerprint.cache_clear()
    try:
        assert detector.runtime.fingerprint != before.fingerprint
        assert detector.artifact_digest == artifact
    finally:
        pipeline_fingerprint.cache_clear()
