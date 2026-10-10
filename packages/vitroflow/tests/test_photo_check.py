import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from vitroflow.cli import main
from vitroflow.photos.suitability import check

SIZE = (1800, 1200)
CENTRE = (900, 600)
RADIUS = 520


def _base() -> np.ndarray:
    image = np.full((SIZE[1], SIZE[0], 3), (25, 25, 25), np.uint8)
    cv2.circle(image, CENTRE, RADIUS, (210, 214, 208), -1)
    cv2.circle(image, CENTRE, RADIUS, (236, 236, 236), 8)
    return image


def _seeds(
    image: np.ndarray, count: int, color: tuple[int, int, int], scale: float
) -> None:
    rng = np.random.default_rng(3)
    for _ in range(count):
        angle = rng.uniform(0, 2 * np.pi)
        distance = RADIUS * 0.45 * np.sqrt(rng.uniform())
        centre = (
            round(CENTRE[0] + distance * np.cos(angle)),
            round(CENTRE[1] + distance * np.sin(angle)),
        )
        axes = (
            max(2, round(rng.integers(8, 14) * scale)),
            max(2, round(rng.integers(3, 6) * scale)),
        )
        cv2.ellipse(
            image,
            centre,
            axes,
            float(rng.uniform(0, 180)),
            0,
            360,
            color,
            -1,
        )


def _sharp() -> np.ndarray:
    image = _base()
    _seeds(image, 40, (40, 80, 140), 1.0)
    return image


def _soft() -> np.ndarray:
    sharp = _sharp()
    blurred = cv2.GaussianBlur(sharp, (0, 0), 12.0)
    mask = np.zeros(sharp.shape[:2], np.uint8)
    cv2.circle(mask, CENTRE, round(RADIUS * 0.85), 255, -1)
    return np.where(mask[:, :, None] > 0, blurred, sharp)


def _germinated() -> np.ndarray:
    image = _base()
    _seeds(image, 18, (170, 230, 245), 2.2)
    return image


def _droplets() -> np.ndarray:
    image = _base()
    rng = np.random.default_rng(5)
    for _ in range(900):
        angle = rng.uniform(0, 2 * np.pi)
        distance = RADIUS * 0.55 * np.sqrt(rng.uniform())
        centre = (
            round(CENTRE[0] + distance * np.cos(angle)),
            round(CENTRE[1] + distance * np.sin(angle)),
        )
        cv2.circle(image, centre, int(rng.integers(2, 4)), (248, 248, 248), -1)
    return image


def _write(folder: Path, name: str, image: np.ndarray) -> None:
    cv2.imwrite(str(folder / name), image)


def test_sharp_seeds_and_germinated_seeds_can_be_counted(tmp_path: Path) -> None:
    _write(tmp_path, "sharp.png", _sharp())
    _write(tmp_path, "germinated.png", _germinated())

    result = check(tmp_path)

    by_name = {item.path.name: item for item in result.photographs}
    assert by_name["sharp.png"].suitable
    assert by_name["sharp.png"].reason is None
    assert by_name["germinated.png"].suitable
    assert result.skipped == ()


def test_a_soft_dish_and_a_droplet_carpet_are_set_aside(tmp_path: Path) -> None:
    _write(tmp_path, "soft.png", _soft())
    _write(tmp_path, "droplets.png", _droplets())

    result = check(tmp_path)

    by_name = {item.path.name: item for item in result.photographs}
    assert by_name["soft.png"].reason == "seeds are out of focus"
    assert not by_name["soft.png"].suitable
    assert by_name["droplets.png"].reason == "paper covered by droplets"
    assert not by_name["droplets.png"].suitable


def test_files_without_a_dish_are_skipped(tmp_path: Path) -> None:
    (tmp_path / "broken.jpg").write_bytes(b"not an image")
    cv2.imwrite(str(tmp_path / "blank.png"), np.full((600, 900, 3), 90, np.uint8))
    (tmp_path / "notes.txt").write_text("ignored")

    result = check(tmp_path)

    assert result.photographs == ()
    assert sorted((item.path.name, item.reason) for item in result.skipped) == [
        ("blank.png", "no dish found"),
        ("broken.jpg", "unreadable"),
    ]


def test_check_prints_the_decision_and_leaves_the_files(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _write(tmp_path, "sharp.png", _sharp())
    before = sorted(path.name for path in tmp_path.iterdir())

    assert main(["photos", "check", str(tmp_path)]) == 0

    document = json.loads(capsys.readouterr().out)
    assert document["skipped"] == []
    assert document["photos"] == [
        {
            "path": str((tmp_path / "sharp.png").resolve()),
            "suitable": True,
            "reason": None,
        }
    ]
    assert sorted(path.name for path in tmp_path.iterdir()) == before


def test_check_refuses_a_missing_folder(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["photos", "check", str(tmp_path / "absent")]) == 2
    assert "is not a folder" in capsys.readouterr().err
