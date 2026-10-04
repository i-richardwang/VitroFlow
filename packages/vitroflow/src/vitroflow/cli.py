from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from vitroflow.photos.selection import Selection, select


def _select(args: argparse.Namespace) -> int:
    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        raise ValueError(f"{folder} is not a folder")
    selection = select(folder, progress=lambda line: print(line, file=sys.stderr))
    json.dump(_document(selection), sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


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
        "skipped": [
            {"path": str(skipped.path), "reason": skipped.reason}
            for skipped in selection.skipped
        ],
    }


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
