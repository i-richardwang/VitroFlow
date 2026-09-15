"""Explicit, one-time registration of the Antigravity tool bridge."""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

MCP_SERVER = "vitroflow-annotation"
MCP_TOOLS = ("annotation_view", "annotation_preview", "annotation_submit")


def register_antigravity() -> tuple[Path, Path]:
    root = Path.home() / ".gemini"
    config = root / "config/mcp_config.json"
    settings = root / "antigravity-cli/settings.json"
    documents = {
        path: json.loads(path.read_text().strip() or "{}") if path.exists() else {}
        for path in (config, settings)
    }
    server = {"command": sys.executable, "args": ["-m", "vitroflow.agent_runtimes.mcp"]}
    servers = documents[config].setdefault("mcpServers", {})
    existing = servers.get(MCP_SERVER)
    if existing is not None and existing.get("args") != server["args"]:
        raise ValueError(
            "A different MCP server already uses the vitroflow-annotation name"
        )
    servers[MCP_SERVER] = server
    permissions = documents[settings].setdefault("permissions", {})
    allowed = permissions.setdefault("allow", [])
    for name in MCP_TOOLS:
        rule = f"mcp({MCP_SERVER}/{name})"
        if rule not in allowed:
            allowed.append(rule)
    # Preserve unrelated settings and restrictive ask/deny rules. Runtime
    # permission policy remains authoritative if those rules override this grant.
    for path, document in documents.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, "w") as handle:
                handle.write(json.dumps(document, indent=2) + "\n")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return config, settings


def require_antigravity_registration() -> None:
    path = Path.home() / ".gemini/config/mcp_config.json"
    config = json.loads(path.read_text().strip() or "{}") if path.exists() else {}
    server = config.get("mcpServers", {}).get(MCP_SERVER, {})
    if (
        server.get("args") != ["-m", "vitroflow.agent_runtimes.mcp"]
        or server.get("disabled") is True
    ):
        raise ValueError(
            "Run 'vitroflow annotate setup --runtime antigravity' to register the annotation tools"
        )
