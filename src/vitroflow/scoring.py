from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

import numpy as np

from .candidates import FEATURE_NAMES, CandidateEvidence


@dataclass(frozen=True)
class CandidateModel:
    name: str
    feature_names: tuple[str, ...]
    means: tuple[float, ...]
    scales: tuple[float, ...]
    weights: tuple[float, ...]
    bias: float

    def __post_init__(self) -> None:
        size = len(self.feature_names)
        if self.feature_names != FEATURE_NAMES:
            raise ValueError("Candidate model feature schema does not match runtime")
        if not (len(self.means) == len(self.scales) == len(self.weights) == size):
            raise ValueError("Candidate model vectors must match the feature schema")

    def score(self, evidence: list[CandidateEvidence]) -> np.ndarray:
        if not evidence:
            return np.empty(0, dtype=np.float64)
        matrix = np.vstack([item.to_array() for item in evidence])
        return self.score_features(matrix)

    def score_features(self, matrix: np.ndarray) -> np.ndarray:
        if matrix.ndim != 2 or matrix.shape[1] != len(self.feature_names):
            raise ValueError("Candidate matrix does not match the feature schema")
        normalized = (matrix - np.asarray(self.means)) / np.asarray(self.scales)
        logits = normalized @ np.asarray(self.weights) + self.bias
        logits = np.clip(logits, -30.0, 30.0)
        return 1.0 / (1.0 + np.exp(-logits))

    @property
    def fingerprint(self) -> str:
        payload = {
            "feature_names": self.feature_names,
            "means": self.means,
            "scales": self.scales,
            "weights": self.weights,
            "bias": self.bias,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "fingerprint": self.fingerprint,
            "feature_names": list(self.feature_names),
            "means": list(self.means),
            "scales": list(self.scales),
            "weights": list(self.weights),
            "bias": self.bias,
        }


DEFAULT_MODEL = CandidateModel(
    name="candidate-logistic",
    feature_names=FEATURE_NAMES,
    means=(
        1.6554071211297479,
        0.6990465338665968,
        0.5429474684635723,
        0.37734105671439044,
        0.025807183065559416,
        1.0287143560714727,
        0.10702426245758198,
        2.753053397080707,
        0.4043779733137044,
        0.34121282469573394,
        0.23769675322869716,
    ),
    scales=(
        0.5462185736984315,
        3.1560740940280345,
        3.0310935131664754,
        0.25491765489060825,
        0.20661777423191327,
        0.18195533608718628,
        0.19179423954118685,
        1.9317730816903294,
        0.21579552122048093,
        0.19965617196326363,
        0.1292934724016839,
    ),
    weights=(
        0.47179337388400006,
        -0.22087919030194084,
        0.14042252350708748,
        0.4169066375732485,
        0.5838284845083074,
        -0.1318210180739564,
        0.2093952694632646,
        -0.36246248160769734,
        0.027370073620117293,
        0.5052634238730905,
        0.9248117416581225,
    ),
    bias=-3.871444673260778,
)
