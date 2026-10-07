import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import pytest
from vitroflow.cli import main
from vitroflow.photos.review import bind_review

DOCUMENT = {
    "photos": [
        {
            "path": "",
            "suitable": False,
            "reason": "seeds are out of focus",
        },
        {"path": "", "suitable": True, "reason": None},
    ],
    "skipped": [],
}


def _image(folder: Path, name: str) -> Path:
    path = folder / name
    cv2.imwrite(str(path), np.full((24, 32, 3), (40, 80, 120), np.uint8))
    return path


def _document(folder: Path) -> Path:
    first = _image(folder, "soft.png")
    second = _image(folder, "sharp.png")
    document = json.loads(json.dumps(DOCUMENT))
    document["photos"][0]["path"] = str(first)
    document["photos"][1]["path"] = str(second)
    path = folder / "check.json"
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return path


def _open(url: str, body: dict | None = None) -> tuple[int, bytes]:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    last: Exception | None = None
    for _ in range(50):
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()
        except urllib.error.URLError as error:
            last = error
            threading.Event().wait(0.02)
    raise AssertionError(last)


def test_a_correction_is_kept_and_the_rest_can_be_accepted(tmp_path: Path) -> None:
    path = _document(tmp_path)
    before = {item.name: item.read_bytes() for item in tmp_path.glob("*.png")}
    server = bind_review(path)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    try:
        page, html = _open(f"http://{host}:{port}/")
        assert page == 200
        assert b"Accept remaining suggestions" in html
        assert b"/review.css" in html
        style, css = _open(f"http://{host}:{port}/review.css")
        assert style == 200
        assert b"--color-canvas" in css
        script, code = _open(f"http://{host}:{port}/review.js")
        assert script == 200
        assert b"accept-remaining" in code

        status, body = _open(
            f"http://{host}:{port}/api/photos/0",
            {"suitable": True, "note": " thin, but separate "},
        )
        assert status == 200
        view = json.loads(body)
        assert view["photos"][0]["name"] == "soft.png"
        assert view["photos"][0]["suitable"] is False
        assert view["photos"][0]["decision"] == {
            "suitable": True,
            "note": "thin, but separate",
        }
        assert "path" not in view["photos"][0]

        status, body = _open(f"http://{host}:{port}/api/accept-remaining", {})
        assert status == 200
        accepted = json.loads(body)["photos"]
        assert accepted[0]["decision"]["suitable"] is True
        assert accepted[0]["decision"]["note"] == "thin, but separate"
        assert accepted[1]["decision"] == {"suitable": True, "note": ""}
        assert accepted[1]["suitable"] is True
        assert accepted[1]["reason"] is None

        assert _open(f"http://{host}:{port}/photo/99")[0] == 404
        assert _open(f"http://{host}:{port}/photo/../check.json")[0] == 404
        assert (
            _open(f"http://{host}:{port}/api/photos/0", {"suitable": "yes"})[0] == 400
        )
        photo, image = _open(f"http://{host}:{port}/photo/0")
        assert photo == 200
        assert image.startswith(b"\x89PNG")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["photos"][0]["suitable"] is False
    assert saved["photos"][0]["reason"] == "seeds are out of focus"
    assert saved["photos"][0]["decision"]["suitable"] is True
    assert saved["photos"][1]["decision"]["suitable"] is True
    assert {item.name: item.read_bytes() for item in tmp_path.glob("*.png")} == before


def test_check_writes_the_same_json_it_prints(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    folder = tmp_path / "photos"
    folder.mkdir()
    cv2.imwrite(str(folder / "blank.png"), np.full((40, 40, 3), 90, np.uint8))
    output = tmp_path / "check.json"

    assert main(["photos", "check", str(folder), "-o", str(output)]) == 0
    assert output.read_text(encoding="utf-8") == capsys.readouterr().out

    assert main(["photos", "check", str(folder), "-o", str(output)]) == 0
    assert output.read_text(encoding="utf-8") == capsys.readouterr().out


def test_check_refuses_to_overwrite_confirmations(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    folder = tmp_path / "photos"
    folder.mkdir()
    cv2.imwrite(str(folder / "blank.png"), np.full((40, 40, 3), 90, np.uint8))
    output = _document(tmp_path)
    saved = json.loads(output.read_text(encoding="utf-8"))
    saved["photos"][0]["decision"] = {"suitable": True, "note": "kept"}
    output.write_text(json.dumps(saved, indent=2) + "\n", encoding="utf-8")
    before = output.read_text(encoding="utf-8")

    assert main(["photos", "check", str(folder), "-o", str(output)]) == 2

    assert "already holds confirmations" in capsys.readouterr().err
    assert output.read_text(encoding="utf-8") == before


def test_review_refuses_a_missing_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["photos", "review", str(tmp_path / "missing.json")]) == 2
    assert "is not a file" in capsys.readouterr().err
