"""Field validators shared by every JSON document parser.

Each validator names the offending field through ``context`` so a nested error
reads as a path, for example ``manifest.images[3].label.image.digest``.
"""

from __future__ import annotations

import math
from typing import Any

from .identifiers import FINGERPRINT, IMAGE_EXTENSIONS


def as_object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(f"{context} must be an object")
    return value


def as_list(value: Any, context: str) -> list[Any]:
    if not isinstance(value, list):
        raise TypeError(f"{context} must be an array")
    return value


def expect_fields(
    value: dict[str, Any],
    required: set[str],
    context: str,
    optional: set[str] | None = None,
) -> None:
    allowed = required | (optional or set())
    missing = required - set(value)
    extra = set(value) - allowed
    if missing or extra:
        details = []
        if missing:
            details.append(f"missing {', '.join(sorted(missing))}")
        if extra:
            details.append(f"unknown {', '.join(sorted(extra))}")
        raise ValueError(f"{context} fields are invalid: {'; '.join(details)}")


def as_string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{context} must be a non-empty string")
    return value


def as_integer(value: Any, context: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{context} must be an integer of at least {minimum}")
    return value


def as_number(value: Any, context: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{context} must be a number")
    number = float(value)
    if not math.isfinite(number) or (positive and number <= 0):
        qualifier = "a finite positive number" if positive else "finite"
        raise ValueError(f"{context} must be {qualifier}")
    return number


def as_digest(value: Any, context: str) -> str:
    digest = as_string(value, context)
    if not FINGERPRINT.fullmatch(digest):
        raise ValueError(f"{context} must be a SHA-256 digest")
    return digest


def as_extension(value: Any, context: str) -> str:
    extension = as_string(value, context)
    if extension not in IMAGE_EXTENSIONS:
        raise ValueError(
            f"{context} must be one of {', '.join(sorted(IMAGE_EXTENSIONS))}"
        )
    return extension


def expect_schema_version(value: dict[str, Any], key: str, version: int, context: str):
    if key not in value:
        raise ValueError(f"{context} fields are invalid: missing {key}")
    found = value[key]
    if isinstance(found, bool) or found != version:
        raise ValueError(f"{context}.{key} must be {version}")
