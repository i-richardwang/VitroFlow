from __future__ import annotations

import json
import os
import re
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .identifiers import VERSION_ID, WORKER_DEVICE, WORKER_ID

PROFILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
PROFILE_FIELDS = {
    "role",
    "server_url",
    "token",
    "worker_id",
    "device",
    "model_version_id",
    "poll_seconds",
}


@dataclass(frozen=True)
class WorkerProfile:
    role: Literal["inference", "training"]
    server_url: str
    token: str
    worker_id: str
    device: str | None = None
    model_version_id: str | None = None
    poll_seconds: float = 5.0

    def __post_init__(self) -> None:
        if self.role not in {"inference", "training"}:
            raise ValueError("worker role must be inference or training")
        if not self.server_url.startswith(("http://", "https://")):
            raise ValueError("server URL must use http or https")
        if not self.token:
            raise ValueError("worker token is required")
        if not WORKER_ID.fullmatch(self.worker_id):
            raise ValueError("worker id is invalid")
        if self.poll_seconds <= 0:
            raise ValueError("poll interval must be positive")
        if self.device is not None and not WORKER_DEVICE.fullmatch(self.device):
            raise ValueError("device must be cpu, mps, cuda, or cuda:<index>")
        if self.role == "inference":
            if not self.model_version_id or not VERSION_ID.fullmatch(
                self.model_version_id
            ):
                raise ValueError("inference profile requires a valid model version id")
        elif self.model_version_id is not None:
            raise ValueError("training profile cannot bind a model version")

    @classmethod
    def from_toml(cls, path: Path) -> WorkerProfile:
        document = tomllib.loads(path.read_text(encoding="utf-8"))
        unknown = set(document) - PROFILE_FIELDS
        if unknown:
            raise ValueError(
                f"unknown worker profile fields: {', '.join(sorted(unknown))}"
            )
        return cls(**document)

    def to_toml(self) -> str:
        values: list[tuple[str, object]] = [
            ("role", self.role),
            ("server_url", self.server_url),
            ("token", self.token),
            ("worker_id", self.worker_id),
        ]
        if self.device is not None:
            values.append(("device", self.device))
        if self.model_version_id is not None:
            values.append(("model_version_id", self.model_version_id))
        values.append(("poll_seconds", self.poll_seconds))
        return "".join(
            f"{key} = {json.dumps(value)}\n"
            if isinstance(value, str)
            else f"{key} = {value}\n"
            for key, value in values
        )


def worker_home() -> Path:
    configured = os.environ.get("VITROFLOW_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".vitroflow"


def validate_profile_name(name: str) -> str:
    if not PROFILE_NAME.fullmatch(name):
        raise ValueError(
            "profile name must use letters, numbers, dots, dashes, or underscores"
        )
    return name


def profile_directory(name: str) -> Path:
    return worker_home() / "profiles" / validate_profile_name(name)


def profile_path(name: str) -> Path:
    return profile_directory(name) / "config.toml"


def profile_exists(name: str) -> bool:
    return profile_path(name).is_file()


def load_profile(name: str) -> WorkerProfile:
    path = profile_path(name)
    if not path.is_file():
        raise FileNotFoundError(f"worker profile does not exist: {name}")
    return WorkerProfile.from_toml(path)


def save_profile(name: str, profile: WorkerProfile, *, overwrite: bool = False) -> Path:
    directory = profile_directory(name)
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    path = directory / "config.toml"
    if path.exists() and not overwrite:
        raise FileExistsError(
            f"worker profile already exists: {name}; use --force to replace it"
        )
    descriptor, temporary_name = tempfile.mkstemp(prefix=".config.", dir=directory)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(profile.to_toml())
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def list_profiles() -> tuple[str, ...]:
    profiles = worker_home() / "profiles"
    if not profiles.is_dir():
        return ()
    return tuple(
        path.parent.name
        for path in sorted(profiles.glob("*/config.toml"))
        if path.is_file()
    )
