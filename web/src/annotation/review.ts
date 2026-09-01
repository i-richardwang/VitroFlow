import type { DetectionResult } from "../detection/schema";
import type { Model } from "../models/schema";
import type { AnnotationDocument, AnnotationRef } from "./schema";

interface ReviewBase {
  ref: AnnotationRef;
  model: Model;
  filename: string;
  width: number;
  height: number;
}

export type Review = ReviewBase &
  (
    | { state: "waiting"; detection: null; annotation: null }
    | { state: "detected"; detection: DetectionResult; annotation: null }
    | {
        state: "started";
        detection: DetectionResult;
        annotation: AnnotationDocument;
      }
  );
