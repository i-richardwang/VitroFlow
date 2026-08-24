"""Seed counting from petri-dish photographs."""

from .models import CountResult
from .pipeline import count_seeds

__all__ = ["CountResult", "count_seeds"]
__version__ = "0.1.0"
