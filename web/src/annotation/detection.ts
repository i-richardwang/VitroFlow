import type { DetectionResult } from "../detection/schema";
import {
  newInstanceId,
  type AnnotationDocument,
  type BoundingBox,
  type AnnotationInstance,
  type ImageSize,
} from "./schema";

/**
 * Default square for a box the reviewer adds. The boxes already on the image
 * are the strongest size prior; an image-relative fallback covers an image
 * with none.
 */
export function initialBoxSide(
  instances: readonly { bbox: BoundingBox }[],
  image: ImageSize,
): number {
  const sides = instances
    .map(({ bbox }) => Math.sqrt(bbox.width * bbox.height))
    .sort((left, right) => left - right);
  if (sides.length === 0) {
    return Math.min(image.width, image.height) * 0.0125;
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
