"""Compiled identifier patterns shared by the Server contracts and local tools."""

from __future__ import annotations

import re

SHORT_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

DATASET_NAME = SHORT_IDENTIFIER
WORKER_ID = SHORT_IDENTIFIER
VERSION_ID = IDENTIFIER
IMAGE_STEM = re.compile(r"^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$")
FINGERPRINT = re.compile(r"^[a-f0-9]{64}$")
WARNING_CODE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
