import type { PrelabelResult } from "../detection/schema";
import {
  newInstanceId,
  type AnnotationDocument,
  type BoundingBox,
  type SeedInstance,
} from "./schema";

/**
 * Default square for manually added seeds. Existing prelabel boxes are the
 * strongest size prior; an image-relative fallback also supports zero-box
 * prelabels and future detectors without dish diagnostics.
 */
export function initialBoxSide(result: PrelabelResult): number {
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

export function instanceFromBox(bbox: BoundingBox): SeedInstance {
  return { id: newInstanceId(), class: "seed", bbox };
}

export function documentFromPrelabel(
  result: PrelabelResult,
): AnnotationDocument {
  return {
    image: {
      path: result.source,
      width: result.image.width,
      height: result.image.height,
    },
    source: {
      prelabelerVersionId: result.producer.version_id,
      prelabelerFingerprint: result.producer.fingerprint,
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
