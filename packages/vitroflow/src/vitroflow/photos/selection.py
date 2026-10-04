"""Turn a folder of photographs into one chosen photograph per dish."""

from __future__ import annotations

import itertools
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from vitroflow.photos.dish import locate_dish
from vitroflow.photos.fingerprint import Survey, dish_motion, survey
from vitroflow.photos.sharpness import SeedView, relative_sharpness, seed_view

PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
# Photographs within this log ratio of the sharpest render the seeds about as
# well; any of them would serve.
COMPARABLE = 0.1

Links = dict[tuple[int, int], np.ndarray]
"""Camera motions between photographs known to show the same dish."""

Comparison = tuple[int, int, float]
"""Two photographs and the log ratio of their seed sharpness."""


@dataclass(frozen=True)
class Shot:
    path: Path
    sharpness: float | None
    """Log ratio of seed sharpness against the chosen shot; None when unmeasured."""


@dataclass(frozen=True)
class Dish:
    shots: tuple[Shot, ...]
    """Sharpest first."""

    @property
    def chosen(self) -> Path:
        return self.shots[0].path

    @property
    def alternatives(self) -> tuple[Path, ...]:
        return tuple(
            shot.path
            for shot in self.shots[1:]
            if shot.sharpness is not None and shot.sharpness >= -COMPARABLE
        )


@dataclass(frozen=True)
class Skipped:
    path: Path
    reason: str


@dataclass(frozen=True)
class Selection:
    dishes: tuple[Dish, ...]
    skipped: tuple[Skipped, ...]


Progress = Callable[[str], None]


def select(folder: Path, progress: Progress = lambda _: None) -> Selection:
    paths = _photos_in(folder)
    with ThreadPoolExecutor() as pool:
        progress(f"Surveying {len(paths)} photographs")
        outcomes = list(pool.map(_survey, paths))
        surveys = [outcome for outcome in outcomes if isinstance(outcome, Survey)]
        skipped = tuple(outcome for outcome in outcomes if isinstance(outcome, Skipped))

        progress("Matching photographs of the same dish")
        pairs = list(itertools.combinations(range(len(surveys)), 2))
        motions = pool.map(lambda pair: dish_motion(*(surveys[i] for i in pair)), pairs)
        links = {
            pair: motion
            for pair, motion in zip(pairs, motions, strict=True)
            if motion is not None
        }

        groups = _groups(len(surveys), links)
        progress(f"Ranking {sum(len(group) > 1 for group in groups)} dishes by focus")
        dishes = pool.map(
            lambda group: _rank([surveys[i] for i in group], _within(group, links)),
            groups,
        )
        return Selection(tuple(dishes), skipped)


def _photos_in(folder: Path) -> list[Path]:
    return sorted(
        path
        for path in folder.iterdir()
        if path.is_file()
        and not path.name.startswith(".")
        and path.suffix.lower() in PHOTO_SUFFIXES
    )


def _survey(path: Path) -> Survey | Skipped:
    gray = _read(path)
    if gray is None:
        return Skipped(path, "unreadable")
    dish = locate_dish(gray)
    if dish is None:
        return Skipped(path, "no dish found")
    return survey(path, gray, dish)


def _read(path: Path) -> np.ndarray | None:
    return cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)


def _groups(count: int, pairs: Iterable[tuple[int, int]]) -> list[list[int]]:
    """Photographs joined by any chain of pairs, in folder order."""
    parent = list(range(count))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in pairs:
        parent[root(a)] = root(b)
    groups: dict[int, list[int]] = {}
    for i in range(count):
        groups.setdefault(root(i), []).append(i)
    return sorted(groups.values(), key=lambda group: group[0])


def _within(group: Sequence[int], links: Links) -> Links:
    """The links among one group, indexed by position within it."""
    position = {index: i for i, index in enumerate(group)}
    return {
        (position[a], position[b]): motion
        for (a, b), motion in links.items()
        if a in position and b in position
    }


def _rank(members: Sequence[Survey], links: Links) -> Dish:
    if len(members) == 1:
        return Dish((Shot(members[0].path, None),))

    views = [_seed_view(member) for member in members]
    comparisons: list[Comparison] = []
    for (i, j), motion in links.items():
        view_a, view_b = views[i], views[j]
        if view_a is None or view_b is None:
            continue
        ratio = relative_sharpness(view_a, view_b, motion)
        if ratio is not None:
            comparisons.append((i, j, ratio))

    scores = _scores(_connected(len(members), comparisons))
    best = max(scores.values(), default=0.0)
    order = sorted(
        range(len(members)),
        key=lambda i: (i not in scores, -scores.get(i, 0.0), members[i].path),
    )
    return Dish(
        tuple(
            Shot(members[i].path, scores[i] - best if i in scores else None)
            for i in order
        )
    )


def _seed_view(member: Survey) -> SeedView | None:
    gray = _read(member.path)
    return None if gray is None else seed_view(gray, member.dish)


def _connected(count: int, comparisons: Sequence[Comparison]) -> list[Comparison]:
    """The comparisons among the largest set of photographs they chain together.

    Ratios fix sharpness only relative to photographs compared through some
    chain, so scores from separate chains cannot be ranked against each other.
    """
    largest = set(max(_groups(count, ((i, j) for i, j, _ in comparisons)), key=len))
    return [comparison for comparison in comparisons if comparison[0] in largest]


def _scores(comparisons: Sequence[Comparison]) -> dict[int, float]:
    """One sharpness per photograph that best explains every pairwise ratio."""
    measured = sorted({k for i, j, _ in comparisons for k in (i, j)})
    column = {i: k for k, i in enumerate(measured)}
    rows = np.zeros((len(comparisons) + 1, len(measured)))
    values = np.zeros(len(comparisons) + 1)
    for row, (i, j, ratio) in enumerate(comparisons):
        rows[row, column[i]], rows[row, column[j]] = 1.0, -1.0
        values[row] = ratio
    # Only differences are observed; fixing their sum makes the solution unique.
    rows[-1, :] = 1.0
    solution = np.linalg.lstsq(rows, values, rcond=None)[0]
    return {i: float(solution[k]) for i, k in column.items()}
