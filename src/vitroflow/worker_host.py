from __future__ import annotations

import json
import logging
import os
import time
from collections import deque

import httpx

from .worker import run_worker
from .worker_launchd import service_loaded
from .worker_profiles import WorkerProfile, load_profile, profile_directory
from .worker_runtime import profile_logging
from .worker_session import WorkerSettings, available_runtimes

LOGGER = logging.getLogger(__name__)


def _settings(name: str, profile: WorkerProfile) -> WorkerSettings:
    return WorkerSettings(
        server_url=profile.server_url,
        token=profile.token,
        worker_id=profile.worker_id,
        work_dir=profile_directory(name) / "work",
        poll_seconds=profile.poll_seconds,
        device=profile.device,
    )


def _check_device(device: str | None) -> None:
    if device is None or device == "cpu":
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


def _check_ready(profile: WorkerProfile) -> None:
    """The Server admits this credential to the worker realm."""
    response = httpx.get(
        f"{profile.server_url.rstrip('/')}/api/worker/ready",
        headers={"Authorization": f"Bearer {profile.token}"},
        timeout=30,
    )
    response.raise_for_status()


def preflight_profile(name: str, profile: WorkerProfile) -> tuple[str, ...]:
    directory = profile_directory(name)
    work = directory / "work"
    work.mkdir(parents=True, exist_ok=True)
    if not os.access(work, os.W_OK):
        raise PermissionError(f"worker directory is not writable: {work}")
    _check_ready(profile)
    checks = [
        f"profile: {name}",
        f"server: {profile.server_url}",
        f"work directory: {work}",
    ]
    adapters = [runtime.adapter for runtime in available_runtimes()]
    runtimes = [
        f"ultralytics ({profile.device})"
        if adapter == "ultralytics" and profile.device
        else adapter
        for adapter in adapters
    ]
    checks.append(f"runtimes: {', '.join(runtimes)}")
    _check_device(profile.device)
    if profile.device:
        checks.append(f"device: {profile.device}")
    return tuple(checks)


def doctor_profile(name: str) -> tuple[str, ...]:
    return preflight_profile(name, load_profile(name))


def _write_status(name: str, state: str, *, detail: str | None = None) -> None:
    """Records how the process last left off, and why when it failed."""
    path = profile_directory(name) / "status.json"
    document: dict[str, object] = {"state": state}
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

            result = run_worker(_settings(name, profile), on_ready=ready)
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
    """
    One line per profile. A process that is killed outright never records how
    it left off, so a running status without a loaded service reads as stale.
    """
    profile = load_profile(name)
    status = _read_status(name)
    loaded = service_loaded(name)
    state = str(status.get("state")) if status else "never started"
    if state == "running" and not loaded:
        state = "stale"
    if status and status.get("detail"):
        state = f"{state}: {status['detail']}"
    device = profile.device or "cpu"
    service = "loaded" if loaded else "not loaded"
    return f"{name}\t{state}\t{service}\t{device}"


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
