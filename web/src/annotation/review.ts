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

/**
 * One image as the reviewer sees it for one model. The detection shown is a
 * reference: the version the reviewer arrived from, or the model's newest
 * that has detected the image. A started review may have none when the
 * annotation reached this workbench ahead of any detection of its own.
 */
export type Review = ReviewBase &
  (
    | { state: "waiting"; detection: null; annotation: null }
    | { state: "detected"; detection: DetectionResult; annotation: null }
    | {
        state: "started";
        detection: DetectionResult | null;
        annotation: AnnotationDocument;
      }
  );
