from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from vitroflow.photos.photographs import Skipped
from vitroflow.photos.review import (
    has_confirmations,
    load_review,
    save_review,
    serve_review,
)
from vitroflow.photos.selection import Selection, select
from vitroflow.photos.suitability import Check, check


def _select(args: argparse.Namespace) -> int:
    selection = select(_folder(args.folder), progress=_progress)
    json.dump(_document(selection), sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


def _check(args: argparse.Namespace) -> int:
    folder = _folder(args.folder)
    output = _unconfirmed(args.output)
    document = _check_document(check(folder, progress=_progress))
    if output is not None:
        save_review(output, document)
    json.dump(document, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


def _review(args: argparse.Namespace) -> int:
    path = Path(args.file).expanduser()
    if not path.is_file():
        raise ValueError(f"{path} is not a file")
    serve_review(path)
    return 0


def _unconfirmed(output: str | None) -> Path | None:
    """Where the check may be written: a file that holds no confirmation."""
    if output is None:
        return None
    path = Path(output).expanduser()
    if path.is_file() and has_confirmations(load_review(path)):
        raise ValueError(f"{path} already holds confirmations")
    return path


def _folder(folder: str) -> Path:
    path = Path(folder).expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"{path} is not a folder")
    return path


def _progress(line: str) -> None:
    print(line, file=sys.stderr)


def _document(selection: Selection) -> dict[str, object]:
    return {
        "dishes": [
            {
                "chosen": str(dish.chosen),
                "alternatives": [str(path) for path in dish.alternatives],
                "photos": [
                    {
                        "path": str(shot.path),
                        "sharpness": None
                        if shot.sharpness is None
                        else round(shot.sharpness, 3),
                    }
                    for shot in dish.shots
                ],
            }
            for dish in selection.dishes
        ],
        "skipped": _skipped(selection.skipped),
    }


def _check_document(result: Check) -> dict[str, object]:
    return {
        "photos": [
            {
                "path": str(photo.path),
                "suitable": photo.suitable,
                "reason": photo.reason,
            }
            for photo in result.photographs
        ],
        "skipped": _skipped(result.skipped),
    }


def _skipped(skipped: tuple[Skipped, ...]) -> list[dict[str, str]]:
    return [{"path": str(item.path), "reason": item.reason} for item in skipped]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vitroflow",
        description="Prepare culture-dish photographs for a VitroFlow workbench.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    photos = commands.add_parser("photos", help="Work with a folder of photographs")
    photo_commands = photos.add_subparsers(dest="photos_command", required=True)
    selecting = photo_commands.add_parser(
        "select",
        help="Group the photographs of each dish and choose the sharpest",
        description=(
            "Group the photographs in FOLDER by the dish they show and choose, "
            "for each dish, the one whose seeds are sharpest. Prints JSON; "
            "files are left untouched."
        ),
    )
    selecting.add_argument("folder", metavar="FOLDER")
    selecting.set_defaults(handler=_select)
    checking = photo_commands.add_parser(
        "check",
        help="Decide whether each photograph is clear enough to count",
        description=(
            "Decide, for each photograph in FOLDER, whether its seeds can be "
            "told apart well enough to count. A photograph can be the sharpest "
            "of its dish and still be set aside. Prints JSON; files are left "
            "untouched."
        ),
    )
    checking.add_argument("folder", metavar="FOLDER")
    checking.add_argument(
        "-o",
        "--output",
        metavar="FILE",
        help=(
            "also write the JSON to FILE; refused when FILE already holds confirmations"
        ),
    )
    checking.set_defaults(handler=_check)
    reviewing = photo_commands.add_parser(
        "review",
        help="Confirm or correct whether each photograph can be counted",
        description=(
            "Serve a page to confirm or correct the suggestions in FILE. "
            "Confirmations are written back into FILE. The photographs stay "
            "where they are."
        ),
    )
    reviewing.add_argument("file", metavar="FILE")
    reviewing.set_defaults(handler=_review)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.handler(args)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
