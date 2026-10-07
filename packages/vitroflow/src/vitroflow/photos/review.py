"""Confirm each suggestion from a check, and keep that confirmation.

``photos check`` records whether a photograph looks countable. That record is a
suggestion. The page opened here lets a person accept it or replace it. The
suggestion stays; a later step trusts ``decision``.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2

ROOT = Path(__file__).parent
PAGES = {
    "/": ("review_page.html", "text/html; charset=utf-8"),
    "/review.css": ("review.css", "text/css; charset=utf-8"),
    "/review.js": ("review.js", "text/javascript; charset=utf-8"),
}
THUMB_EDGE = 180


def load_review(path: Path) -> dict:
    """The check document at ``path``, with each photograph's confirmation."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path} is not a check result") from error
    if not _document(document):
        raise ValueError(f"{path} is not a check result")
    return document


def has_confirmations(document: dict) -> bool:
    return any(photo.get("decision") is not None for photo in document["photos"])


def confirm(document: dict, index: int, suitable: bool | None, note: str) -> None:
    document["photos"][index]["decision"] = {"suitable": suitable, "note": note}


def clear_confirmation(document: dict, index: int) -> None:
    document["photos"][index]["decision"] = None


def accept_remaining(document: dict) -> None:
    """Copy the suggestion onto every photograph that has no confirmation yet."""
    for photo in document["photos"]:
        if photo.get("decision") is not None:
            continue
        photo["decision"] = {"suitable": photo["suitable"], "note": ""}


def save_review(path: Path, document: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def bind_review(path: Path, port: int = 0) -> ReviewServer:
    return ReviewServer(("127.0.0.1", port), load_review(path), path)


def serve_review(path: Path) -> None:
    server = bind_review(path)
    host, port = server.server_address[:2]
    count = len(server.document["photos"])
    print(f"Review {count} photographs at http://{host}:{port}", flush=True)
    print(f"Confirmations are written to {path}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(flush=True)
    finally:
        server.server_close()


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], document: dict, path: Path) -> None:
        self.document = document
        self.review_path = path
        self.lock = threading.Lock()
        super().__init__(address, ReviewHandler)


class ReviewHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: ReviewServer

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        if str(code).startswith("2"):
            return
        super().log_request(code, size)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        page = PAGES.get(path)
        if page:
            name, content_type = page
            self._send((ROOT / name).read_bytes(), content_type)
            return
        if path == "/api/review":
            body = json.dumps(_view(self.server.document), ensure_ascii=False).encode()
            self._send(body, "application/json; charset=utf-8")
            return
        media = _media(path)
        if media is None:
            self.send_error(404)
            return
        kind, index = media
        photo = _photo_at(self.server.document, index)
        if photo is None:
            self.send_error(404)
            return
        file_path = Path(photo["path"])
        if kind == "thumb":
            file_path = _thumbnail(file_path) or file_path
        if not file_path.is_file():
            self.send_error(404)
            return
        self._send_file(file_path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        payload = self._payload()
        if payload is None:
            self.send_error(400)
            return
        with self.server.lock:
            document = self.server.document
            if path == "/api/accept-remaining":
                accept_remaining(document)
            elif path.startswith("/api/photos/"):
                index = _index(path.removeprefix("/api/photos/"))
                if index is None or _photo_at(document, index) is None:
                    self.send_error(404)
                    return
                if not _apply(document, index, payload):
                    self.send_error(400)
                    return
            else:
                self.send_error(404)
                return
            save_review(self.server.review_path, document)
            body = json.dumps(_view(document), ensure_ascii=False).encode()
        self._send(body, "application/json; charset=utf-8")

    def _payload(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def _send(self, body: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        data = path.read_bytes()
        kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=86400")
        self.end_headers()
        self.wfile.write(data)


def _document(document: object) -> bool:
    if not isinstance(document, dict):
        return False
    return _photos(document.get("photos")) and _skipped(document.get("skipped"))


def _photos(photos: object) -> bool:
    return isinstance(photos, list) and all(_suggestion(photo) for photo in photos)


def _suggestion(photo: object) -> bool:
    if not isinstance(photo, dict):
        return False
    return (
        isinstance(photo.get("path"), str)
        and isinstance(photo.get("suitable"), bool)
        and (photo.get("reason") is None or isinstance(photo.get("reason"), str))
        and _decision(photo.get("decision"))
    )


def _decision(decision: object) -> bool:
    if decision is None:
        return True
    if not isinstance(decision, dict):
        return False
    return _flag(decision.get("suitable")) and isinstance(decision.get("note"), str)


def _skipped(skipped: object) -> bool:
    if not isinstance(skipped, list):
        return False
    return all(
        isinstance(item, dict)
        and isinstance(item.get("path"), str)
        and isinstance(item.get("reason"), str)
        for item in skipped
    )


def _flag(value: object) -> bool:
    return value is True or value is False or value is None


def _apply(document: dict, index: int, payload: dict) -> bool:
    if payload.get("clear") is True:
        clear_confirmation(document, index)
        return True
    if "suitable" not in payload or not _flag(payload["suitable"]):
        return False
    note = payload.get("note", "")
    if not isinstance(note, str):
        return False
    confirm(document, index, payload["suitable"], note.strip())
    return True


def _index(text: str) -> int | None:
    return int(text) if text.isdigit() else None


def _photo_at(document: dict, index: int) -> dict | None:
    photos = document["photos"]
    if not 0 <= index < len(photos):
        return None
    return photos[index]


def _media(path: str) -> tuple[str, int] | None:
    for name in ("photo", "thumb"):
        prefix = f"/{name}/"
        number = path.removeprefix(prefix)
        if path.startswith(prefix) and number.isdigit():
            return name, int(number)
    return None


def _view(document: dict) -> dict:
    return {
        "photos": [
            {
                "index": index,
                "name": Path(photo["path"]).name,
                "suitable": photo["suitable"],
                "reason": photo.get("reason"),
                "decision": photo.get("decision"),
            }
            for index, photo in enumerate(document["photos"])
        ],
        "skipped": len(document["skipped"]),
    }


def _thumbnail(source: Path) -> Path | None:
    if not source.is_file():
        return None
    folder = Path(tempfile.gettempdir()) / "vitroflow-review"
    folder.mkdir(exist_ok=True)
    digest = hashlib.sha256(str(source).encode()).hexdigest()[:16]
    destination = folder / f"{digest}-{source.stat().st_mtime_ns}.jpg"
    if destination.is_file():
        return destination
    image = cv2.imread(str(source), cv2.IMREAD_COLOR)
    if image is None:
        return None
    height, width = image.shape[:2]
    scale = THUMB_EDGE / max(height, width)
    if scale < 1:
        image = cv2.resize(
            image,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    if not cv2.imwrite(str(destination), image):
        return None
    return destination
