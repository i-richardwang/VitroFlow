"""Explicit configuration and construction of supported external runtimes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from vitroflow.agent_runtimes.antigravity import AntigravityRuntime
from vitroflow.agent_runtimes.contract import AgentRuntime
from vitroflow.agent_runtimes.pi import PiRuntime

RuntimeName = Literal["pi", "antigravity"]
RUNTIME_NAMES = ("pi", "antigravity")


@dataclass(frozen=True)
class RuntimeConfig:
    runtime: RuntimeName
    model: str | None = None
    executable: str | None = None
    timeout_seconds: float = 1800

    def create(self) -> AgentRuntime:
        if self.runtime == "pi":
            return PiRuntime(self.model, self.executable or "pi", self.timeout_seconds)
        if self.runtime == "antigravity":
            return AntigravityRuntime(
                self.model, self.executable or "agy", self.timeout_seconds
            )
        raise ValueError(f"Unknown agent runtime: {self.runtime}")
