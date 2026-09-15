"""External runtime inputs; annotation geometry belongs to the caller."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class AgentInterruptedError(RuntimeError):
    """The supervisor cancelled an external agent process."""


@dataclass(frozen=True)
class ToolSet:
    """A local tool command supporting invoke and stdio MCP transports."""

    command: tuple[str, ...]
    definitions: tuple[dict, ...]


class AgentRuntime(Protocol):
    def probe(self) -> dict: ...

    def execute(
        self,
        prompt: str,
        directory: Path,
        *,
        descriptor: dict,
        tools: ToolSet,
        cancelled: Callable[[], bool] = lambda: False,
        tick: Callable[[], None] = lambda: None,
        completed: Callable[[], bool] = lambda: False,
    ) -> dict: ...
