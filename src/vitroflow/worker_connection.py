from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from .identifiers import WORKER_DEVICE, WORKER_ID

RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})


@dataclass(frozen=True, slots=True, kw_only=True)
class WorkerConnection:
    server_url: str
    token: str

    def __post_init__(self) -> None:
        if not self.server_url.startswith(("http://", "https://")):
            raise ValueError("worker server URL must use http or https")
        if not self.token:
            raise ValueError("worker token is required")

    @property
    def base_url(self) -> str:
        return self.server_url.rstrip("/") + "/"


def validate_worker_process(
    worker_id: str,
    poll_seconds: float,
    device: str | None,
    *,
    device_required: bool = False,
) -> None:
    if not WORKER_ID.fullmatch(worker_id):
        raise ValueError("worker id is invalid")
    if poll_seconds <= 0:
        raise ValueError("poll interval must be positive")
    if device_required and device is None:
        raise ValueError("worker device is required")
    if device is not None and not WORKER_DEVICE.fullmatch(device):
        raise ValueError("device must be cpu, mps, cuda, or cuda:<index>")


class WorkerHttpClient:
    def __init__(
        self,
        connection: WorkerConnection,
        *,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=connection.base_url,
            headers={"Authorization": f"Bearer {connection.token}"},
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        for attempt in range(3):
            try:
                response = self._client.request(method, url, **kwargs)
            except httpx.TransportError:
                if attempt == 2:
                    raise
            else:
                if response.status_code not in RETRYABLE_STATUS_CODES or attempt == 2:
                    return response
                response.close()
            time.sleep(0.5 * 2**attempt)
        raise RuntimeError("HTTP retry loop ended without a response")
