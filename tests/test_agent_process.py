"""Cleanup must distinguish a departed child from a live permission failure."""

from types import SimpleNamespace

import pytest

from vitroflow.agent_runtimes import process


@pytest.mark.parametrize("exit_code", [0, None])
def test_cleanup_permission_error_after_exit(monkeypatch, exit_code):
    def denied(*_args):
        raise PermissionError("Operation not permitted")

    monkeypatch.setattr(process.os, "killpg", denied)
    child = SimpleNamespace(pid=123, poll=lambda: exit_code, wait=lambda **_: 0)
    if exit_code is None:
        with pytest.raises(PermissionError):
            process.terminate_process(child)
    else:
        process.terminate_process(child)
