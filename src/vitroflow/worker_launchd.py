from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from .worker_profiles import (
    load_profile,
    profile_directory,
    validate_profile_name,
    worker_home,
)

LABEL_PREFIX = "com.vitroflow.worker"


def service_label(name: str) -> str:
    return f"{LABEL_PREFIX}.{validate_profile_name(name)}"


def launch_agent_path(name: str) -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{service_label(name)}.plist"


def launch_agent_document(name: str, executable: str | None = None) -> dict[str, Any]:
    command = executable or shutil.which("vitroflow")
    if not command:
        raise RuntimeError("vitroflow executable is not available on PATH")
    directory = profile_directory(name)
    return {
        "Label": service_label(name),
        "ProgramArguments": [command, "worker", "run", name],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "WorkingDirectory": str(directory),
        "EnvironmentVariables": {"VITROFLOW_HOME": str(worker_home())},
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }


def require_launchd() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("native worker services currently require macOS launchd")


def install_launch_agent(name: str) -> Path:
    require_launchd()
    load_profile(name)
    path = launch_agent_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".plist.tmp")
    temporary.write_bytes(plistlib.dumps(launch_agent_document(name), sort_keys=True))
    temporary.replace(path)
    return path


def _service_target(name: str) -> str:
    return f"gui/{os.getuid()}/{service_label(name)}"


def _launchctl(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["launchctl", *arguments],
        check=check,
        capture_output=True,
        text=True,
    )


def service_loaded(name: str) -> bool:
    if sys.platform != "darwin":
        return False
    return _launchctl("print", _service_target(name), check=False).returncode == 0


def start_service(name: str) -> None:
    path = install_launch_agent(name)
    if service_loaded(name):
        _launchctl("kickstart", _service_target(name))
    else:
        _launchctl("bootstrap", f"gui/{os.getuid()}", str(path))


def stop_service(name: str) -> None:
    require_launchd()
    load_profile(name)
    if service_loaded(name):
        _launchctl("bootout", _service_target(name))


def restart_service(name: str) -> None:
    path = install_launch_agent(name)
    if service_loaded(name):
        _launchctl("kickstart", "-k", _service_target(name))
    else:
        _launchctl("bootstrap", f"gui/{os.getuid()}", str(path))
