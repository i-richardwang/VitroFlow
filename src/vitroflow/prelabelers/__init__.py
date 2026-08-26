"""Runtime boundary shared by every prelabel implementation."""

from .contract import (
    DishGeometry,
    PrelabelDiagnostics,
    Prelabeler,
    PrelabelerDescriptor,
    PrelabelFailure,
    PrelabelInstance,
    PrelabelQuality,
    PrelabelResult,
)
from .documents import (
    PrelabelDocument,
    load_prelabel_document,
    parse_prelabel_document,
)
from .traditional import TraditionalPrelabeler

__all__ = [
    "DishGeometry",
    "PrelabelDiagnostics",
    "PrelabelDocument",
    "PrelabelFailure",
    "PrelabelInstance",
    "PrelabelQuality",
    "PrelabelResult",
    "Prelabeler",
    "PrelabelerDescriptor",
    "TraditionalPrelabeler",
    "load_prelabel_document",
    "parse_prelabel_document",
]
