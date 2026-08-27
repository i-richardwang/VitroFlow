from __future__ import annotations

import importlib.util
import json
import logging
import os
import time
from collections import deque
from datetime import UTC, datetime

import httpx

from .inference_worker import (
    InferenceWorkerSettings,
    deployment_manifest,
    run_inference_worker,
)
from .training_configs import default_training_config_root
from .training_worker import TrainingWorkerSettings, run_training_worker
from .worker_launchd import service_loaded
from .worker_profiles import WorkerProfile, load_profile, profile_directory
from .worker_runtime import profile_logging

LOGGER = logging.getLogger(__name__)


def _inference_settings(name: str, profile: WorkerProfile) -> InferenceWorkerSettings:
    return InferenceWorkerSettings(
        server_url=profile.server_url,
        token=profile.token,
        worker_id=profile.worker_id,
        model_version_id=profile.model_version_id or "",
        work_dir=profile_directory(name) / "work",
        poll_seconds=profile.poll_seconds,
        device=profile.device,
    )


def _training_settings(name: str, profile: WorkerProfile) -> TrainingWorkerSettings:
    return TrainingWorkerSettings(
        server_url=profile.server_url,
        token=profile.token,
        worker_id=profile.worker_id,
        device=profile.device or "cpu",
        work_dir=profile_directory(name) / "work",
        config_root=default_training_config_root(),
        poll_seconds=profile.poll_seconds,
    )


def _check_device(device: str | None) -> None:
    if device in {None, "cpu"}:
        return
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("device validation requires vitroflow[yolo]") from error
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS is not available on this machine")
    if device.startswith("cuda"):
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available on this machine")
        index = int(device.partition(":")[2] or "0")
        if index >= torch.cuda.device_count():
            raise RuntimeError(f"CUDA device {index} is not available")


def preflight_profile(name: str, profile: WorkerProfile) -> tuple[str, ...]:
    directory = profile_directory(name)
    work = directory / "work"
    work.mkdir(parents=True, exist_ok=True)
    if not os.access(work, os.W_OK):
        raise PermissionError(f"worker directory is not writable: {work}")
    checks = [
        f"profile: {name} ({profile.role})",
        f"server: {profile.server_url}",
        f"work directory: {work}",
    ]

    needs_yolo = profile.role == "training"
    if profile.role == "inference":
        settings = _inference_settings(name, profile)
        artifact = deployment_manifest(settings)["artifact"]
        kind = artifact["kind"]
        if kind == "traditional" and profile.device:
            raise ValueError("traditional inference profiles cannot select a device")
        needs_yolo = kind == "ultralytics"
        checks.append(f"model version: {profile.model_version_id} ({kind})")
    else:
        settings = _training_settings(name, profile)
        response = httpx.get(
            f"{settings.server_url.rstrip('/')}/api/training/ready",
            headers={"Authorization": f"Bearer {settings.token}"},
            timeout=30,
        )
        response.raise_for_status()
        document = response.json()
        if document != {"role": "training"}:
            raise ValueError("Server returned an invalid training readiness response")
        checks.append(f"training configs: {settings.config_root}")

    if needs_yolo and importlib.util.find_spec("ultralytics") is None:
        raise RuntimeError("YOLO runtime is missing; install vitroflow[yolo]")
    _check_device(profile.device)
    if profile.device:
        checks.append(f"device: {profile.device}")
    return tuple(checks)


def doctor_profile(name: str) -> tuple[str, ...]:
    return preflight_profile(name, load_profile(name))


def _write_status(name: str, state: str, *, detail: str | None = None) -> None:
    path = profile_directory(name) / "status.json"
    document: dict[str, object] = {
        "state": state,
        "pid": os.getpid(),
        "updatedAt": datetime.now(UTC).isoformat(),
    }
    if detail:
        document["detail"] = detail
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def run_profile(name: str) -> int:
    directory = profile_directory(name)
    directory.mkdir(parents=True, exist_ok=True)
    with profile_logging(directory / "worker.log"):
        _write_status(name, "starting")
        try:
            profile = load_profile(name)

            def ready() -> None:
                _write_status(name, "running")

            if profile.role == "inference":
                result = run_inference_worker(
                    _inference_settings(name, profile), on_ready=ready
                )
            else:
                result = run_training_worker(
                    _training_settings(name, profile), on_ready=ready
                )
        except Exception as error:
            LOGGER.exception("worker stopped after an error")
            _write_status(name, "failed", detail=str(error))
            return 1
        _write_status(name, "stopped" if result == 0 else "failed")
        return result


def _read_status(name: str) -> dict[str, object] | None:
    path = profile_directory(name) / "status.json"
    if not path.is_file():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else None


def profile_summary(name: str) -> str:
    profile = load_profile(name)
    status = _read_status(name)
    state = str(status.get("state")) if status else "never started"
    loaded = "loaded" if service_loaded(name) else "not loaded"
    target = profile.model_version_id or profile.device or "cpu"
    return f"{name}\t{profile.role}\t{state}\t{loaded}\t{target}"


def tail_log(name: str, *, lines: int = 100, follow: bool = False) -> None:
    if lines <= 0:
        raise ValueError("log line count must be positive")
    path = profile_directory(name) / "worker.log"
    if not path.exists():
        return
    handle = path.open(encoding="utf-8", errors="replace")
    try:
        for line in deque(handle, maxlen=lines):
            print(line, end="")
        while follow:
            line = handle.readline()
            if line:
                print(line, end="", flush=True)
                continue
            try:
                rotated = path.stat().st_ino != os.fstat(handle.fileno()).st_ino
            except FileNotFoundError:
                rotated = False
            if rotated:
                handle.close()
                handle = path.open(encoding="utf-8", errors="replace")
            else:
                time.sleep(0.25)
    finally:
        handle.close()
