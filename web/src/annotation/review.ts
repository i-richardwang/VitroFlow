import type { DetectionResult } from "../detection/schema";
import type { Model } from "../models/schema";
import type { AnnotationDocument, LabelRef } from "./schema";

interface ReviewBase {
  ref: LabelRef;
  model: Model;
  filename: string;
  width: number;
  height: number;
}

export type Review = ReviewBase &
  (
    | { state: "waiting"; detection: null; label: null }
    | { state: "detected"; detection: DetectionResult; label: null }
    | {
        state: "started";
        detection: DetectionResult;
        label: AnnotationDocument;
      }
  );
