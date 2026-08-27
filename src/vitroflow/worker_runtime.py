from __future__ import annotations

import logging
import signal
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


@contextmanager
def shutdown_signals() -> Iterator[threading.Event]:
    """Translate process termination into cooperative Worker shutdown."""
    stopped = threading.Event()
    if threading.current_thread() is not threading.main_thread():
        yield stopped
        return
    previous: dict[signal.Signals, object] = {}

    def stop(_signum: int, _frame: object) -> None:
        stopped.set()

    for current in (signal.SIGINT, signal.SIGTERM):
        previous[current] = signal.getsignal(current)
        signal.signal(current, stop)
    try:
        yield stopped
    finally:
        for current, handler in previous.items():
            signal.signal(current, handler)


@contextmanager
def profile_logging(path: Path) -> Iterator[None]:
    logger = logging.getLogger("vitroflow")
    previous_level = logger.level
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(
        path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(handler)
    try:
        yield
    finally:
        logger.removeHandler(handler)
        handler.close()
        logger.setLevel(previous_level)
