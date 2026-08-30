"""Runtime boundary shared by every detector implementation."""

from .contract import (
    DetectionDiagnostics,
    DetectionFailure,
    DetectionInstance,
    DetectionProducer,
    DetectionQuality,
    DetectionResult,
    Detector,
    DishGeometry,
    RuntimeDescriptor,
)
from .documents import InferenceOutcome, parse_inference_outcome
from .traditional import TraditionalDetector
from .ultralytics import (
    UltralyticsDetector,
    YoloInferenceSettings,
    load_yolo_inference_settings,
    ultralytics_runtime_descriptor,
)

__all__ = [
    "DetectionDiagnostics",
    "DetectionFailure",
    "DetectionInstance",
    "DetectionProducer",
    "DetectionQuality",
    "DetectionResult",
    "Detector",
    "DishGeometry",
    "InferenceOutcome",
    "RuntimeDescriptor",
    "TraditionalDetector",
    "UltralyticsDetector",
    "YoloInferenceSettings",
    "load_yolo_inference_settings",
    "parse_inference_outcome",
    "ultralytics_runtime_descriptor",
]
