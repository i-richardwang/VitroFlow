"""Identifier patterns and vocabularies shared by the Server contracts and local tools."""

from __future__ import annotations

import re

SHORT_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

DATASET_NAME = SHORT_IDENTIFIER
WORKER_ID = SHORT_IDENTIFIER
WORKER_DEVICE = re.compile(r"^(?:cpu|mps|cuda(?::[0-9]+)?)$")
VERSION_ID = IDENTIFIER
FINGERPRINT = re.compile(r"^[a-f0-9]{64}$")
WARNING_CODE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
