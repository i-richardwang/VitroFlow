from __future__ import annotations

import json
import os
import re
import tempfile
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path

from vitroflow.agent_runtimes.config import RuntimeConfig
from vitroflow.agent_runtimes.contract import AgentRuntime
from vitroflow.worker.connection import WorkerConnection, validate_worker_process

PROFILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
PROFILE_FIELDS = {
    "server_url",
    "token",
    "worker_id",
    "device",
    "poll_seconds",
    "annotation",
}


@dataclass(frozen=True)
class WorkerProfile:
    """One native Worker process: who it serves, as whom, and on which accelerator."""

    server_url: str
    token: str
    worker_id: str
    device: str | None = None
    poll_seconds: float = 5.0
    annotation: tuple[RuntimeConfig, ...] = ()

    def __post_init__(self) -> None:
        WorkerConnection(server_url=self.server_url, token=self.token)
        validate_worker_process(self.worker_id, self.poll_seconds, self.device)
        if len({item.runtime for item in self.annotation}) != len(self.annotation):
            raise ValueError("Each annotation runtime must appear once")
        for config in self.annotation:
            config.create()

    @property
    def annotation_runtimes(self) -> dict[str, AgentRuntime]:
        return {config.runtime: config.create() for config in self.annotation}

    @classmethod
    def from_toml(cls, path: Path) -> WorkerProfile:
        document = tomllib.loads(path.read_text(encoding="utf-8"))
        unknown = set(document) - PROFILE_FIELDS
        if unknown:
            raise ValueError(
                f"unknown worker profile fields: {', '.join(sorted(unknown))}"
            )
        document["annotation"] = tuple(
            RuntimeConfig(**value) for value in document.get("annotation", [])
        )
        return cls(**document)

    def to_toml(self) -> str:
        values: list[tuple[str, object]] = [
            ("server_url", self.server_url),
            ("token", self.token),
            ("worker_id", self.worker_id),
        ]
        if self.device is not None:
            values.append(("device", self.device))
        values.append(("poll_seconds", self.poll_seconds))
        result = "".join(f"{key} = {json.dumps(value)}\n" for key, value in values)
        for config in self.annotation:
            result += "\n[[annotation]]\n"
            for key, value in asdict(config).items():
                if value is not None:
                    result += f"{key} = {json.dumps(value)}\n"
        return result


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
