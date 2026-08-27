from __future__ import annotations

import logging
import signal
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/healthz":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = b"ok\n"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


@contextmanager
def health_server(port: int | None) -> Iterator[int | None]:
    if port is None:
        yield None
        return
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    thread = threading.Thread(
        target=server.serve_forever,
        name="vitroflow-health",
        daemon=True,
    )
    thread.start()
    try:
        yield server.server_port
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


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


def configure_console_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


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
