"""The exact Ultralytics parameter contract shared by training boundaries."""

from __future__ import annotations

from typing import Any

from .documents import as_integer, as_number, as_object, expect_fields

PARAMETER_NAMES = {
    "epochs",
    "patience",
    "batch",
    "imgsz",
    "optimizer",
    "lr0",
    "warmup_epochs",
    "mosaic",
    "mixup",
    "copy_paste",
    "max_det",
    "seed",
    "deterministic",
}
OPTIMIZERS = {"auto", "SGD", "Adam", "AdamW", "NAdam", "RAdam", "RMSProp"}


def _bounded_integer(
    value: Any, context: str, minimum: int, maximum: int | None = None
) -> int:
    number = as_integer(value, context, minimum)
    if maximum is not None and number > maximum:
        raise ValueError(f"{context} must be at most {maximum}")
    return number


def _bounded_number(value: Any, context: str, minimum: float, maximum: float) -> float:
    number = as_number(value, context)
    if not minimum <= number <= maximum:
        raise ValueError(f"{context} must be between {minimum} and {maximum}")
    return number


def parse_training_parameters(
    value: Any, context: str = "training parameters"
) -> dict[str, Any]:
    """Validate the complete, version-one training parameter set."""

    parameters = as_object(value, context)
    expect_fields(parameters, PARAMETER_NAMES, context)

    _bounded_integer(parameters["epochs"], f"{context}.epochs", 1, 300)
    _bounded_integer(parameters["patience"], f"{context}.patience", 0, 300)
    _bounded_integer(parameters["batch"], f"{context}.batch", 1, 64)
    image_size = _bounded_integer(parameters["imgsz"], f"{context}.imgsz", 320, 2048)
    if image_size % 32:
        raise ValueError(f"{context}.imgsz must be a multiple of 32")
    optimizer = parameters["optimizer"]
    if not isinstance(optimizer, str) or optimizer not in OPTIMIZERS:
        raise ValueError(f"{context}.optimizer is unsupported")
    _bounded_number(parameters["lr0"], f"{context}.lr0", 0.00001, 0.1)
    _bounded_number(
        parameters["warmup_epochs"], f"{context}.warmup_epochs", 0, 10
    )
    for name in ("mosaic", "mixup", "copy_paste"):
        _bounded_number(parameters[name], f"{context}.{name}", 0, 1)
    _bounded_integer(parameters["max_det"], f"{context}.max_det", 1, 10_000)
    _bounded_integer(parameters["seed"], f"{context}.seed", 0)
    if not isinstance(parameters["deterministic"], bool):
        raise TypeError(f"{context}.deterministic must be a boolean")
    return dict(parameters)
