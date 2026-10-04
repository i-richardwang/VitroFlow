import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from vitroflow.cli import main
from vitroflow.photos.selection import select

SIZE = (1800, 1200)
CENTRE = (900.0, 600.0)
RADIUS = 520


def _scene(variant: int) -> np.ndarray:
    """A dish seen from above: seeds scattered inside, a label on the lid."""
    rng = np.random.default_rng(variant)
    image = np.full((SIZE[1], SIZE[0]), 25, np.uint8)
    cv2.circle(image, (900, 600), RADIUS, 150, -1)
    cv2.circle(image, (900, 600), RADIUS, 215, 8)
    for _ in range(45):
        angle, distance = (
            rng.uniform(0, 2 * np.pi),
            RADIUS * 0.5 * np.sqrt(rng.uniform()),
        )
        centre = (
            round(CENTRE[0] + distance * np.cos(angle)),
            round(CENTRE[1] + distance * np.sin(angle)),
        )
        axes = (int(rng.integers(7, 12)), int(rng.integers(3, 6)))
        cv2.ellipse(image, centre, axes, float(rng.uniform(0, 180)), 0, 360, 60, -1)
    cv2.rectangle(image, (790, 120), (1010, 200), 245, -1)
    cv2.putText(image, "LOT 7", (805, 180), cv2.FONT_HERSHEY_SIMPLEX, 1.4, 30, 3)
    return image


def _shot(scene: np.ndarray, angle: float, shift: tuple[float, float]) -> np.ndarray:
    motion = cv2.getRotationMatrix2D(CENTRE, angle, 1.0)
    motion[:, 2] += shift
    return cv2.warpAffine(scene, motion, SIZE, borderValue=25)


def _defocus_seeds(image: np.ndarray, shift: tuple[float, float]) -> np.ndarray:
    """Focus on the lid: the seeds blur while the label stays crisp."""
    blurred = cv2.GaussianBlur(image, (0, 0), 2.5)
    inside = np.zeros_like(image)
    centre = (round(CENTRE[0] + shift[0]), round(CENTRE[1] + shift[1]))
    cv2.circle(inside, centre, round(RADIUS * 0.7), 255, -1)
    return np.where(inside > 0, blurred, image)


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    first, second = _scene(variant=1), _scene(variant=2)
    cv2.imwrite(str(tmp_path / "a-sharp.png"), _shot(first, 3.0, (20, -15)))
    cv2.imwrite(
        str(tmp_path / "a-label.png"),
        _defocus_seeds(_shot(first, -4.0, (-30, 10)), (-30, 10)),
    )
    cv2.imwrite(str(tmp_path / "b.png"), _shot(second, 1.0, (5, 5)))
    return tmp_path


def test_photographs_of_one_dish_are_grouped_and_the_sharp_seeds_win(
    folder: Path,
) -> None:
    selection = select(folder)

    groups = sorted(
        sorted(shot.path.name for shot in dish.shots) for dish in selection.dishes
    )
    assert groups == [["a-label.png", "a-sharp.png"], ["b.png"]]
    first = next(dish for dish in selection.dishes if len(dish.shots) == 2)
    assert first.chosen.name == "a-sharp.png"
    assert first.shots[1].sharpness is not None and first.shots[1].sharpness < -0.1
    assert first.alternatives == ()


def test_files_without_a_dish_are_skipped(tmp_path: Path) -> None:
    (tmp_path / "broken.jpg").write_bytes(b"not an image")
    cv2.imwrite(str(tmp_path / "blank.png"), np.full((600, 900), 90, np.uint8))
    (tmp_path / "notes.txt").write_text("ignored")

    selection = select(tmp_path)

    assert selection.dishes == ()
    assert sorted((item.path.name, item.reason) for item in selection.skipped) == [
        ("blank.png", "no dish found"),
        ("broken.jpg", "unreadable"),
    ]


def test_select_prints_the_choice_and_leaves_the_files(
    folder: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    before = sorted(path.name for path in folder.iterdir())

    assert main(["photos", "select", str(folder)]) == 0

    document = json.loads(capsys.readouterr().out)
    chosen = sorted(Path(dish["chosen"]).name for dish in document["dishes"])
    assert chosen == ["a-sharp.png", "b.png"]
    assert document["skipped"] == []
    assert sorted(path.name for path in folder.iterdir()) == before


def test_select_refuses_a_missing_folder(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["photos", "select", str(tmp_path / "absent")]) == 2
    assert "is not a folder" in capsys.readouterr().err
