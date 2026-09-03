import type { DetectionResult } from "../detection/schema";
import {
  newInstanceId,
  type AnnotationDocument,
  type BoundingBox,
  type AnnotationInstance,
} from "./schema";

/**
 * Default square for manually added instances. Existing detection boxes are the
 * strongest size prior; an image-relative fallback also supports zero-box
 * detections and future detectors without dish diagnostics.
 */
export function initialBoxSide(result: DetectionResult): number {
  const sides = result.instances
    .map(({ bbox }) => Math.sqrt(bbox.width * bbox.height))
    .sort((left, right) => left - right);
  if (sides.length === 0) {
    return Math.min(result.image.width, result.image.height) * 0.0125;
  }
  const middle = Math.floor(sides.length / 2);
  return sides.length % 2 === 1
    ? sides[middle]
    : (sides[middle - 1] + sides[middle]) / 2;
}

export function instanceFromBox(
  className: string,
  bbox: BoundingBox,
): AnnotationInstance {
  return { id: newInstanceId(), class: className, bbox };
}

/** A review that begins with every box the detection found. */
export function documentFromDetection(
  result: DetectionResult,
): AnnotationDocument {
  return {
    schemaVersion: 1,
    image: {
      digest: result.image.digest,
      width: result.image.width,
      height: result.image.height,
    },
    status: "in_progress",
    revision: 0,
    instances: result.instances.map(({ id, class: className, bbox }) => ({
      id,
      class: className,
      bbox,
    })),
  };
}
