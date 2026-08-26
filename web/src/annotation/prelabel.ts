import type { SeedDetection, SeedResult } from "../detection/schema";
import { boxAround } from "./geometry";
import {
  newInstanceId,
  type AnnotationDocument,
  type BoundingBox,
  type ImageSize,
  type SeedInstance,
} from "./schema";

/**
 * Standard box side as a fraction of the dish radius, shared by prelabelled
 * detections and boxes added in the workbench so every seed follows one box
 * convention. Seeds occupy a roughly constant fraction of the dish, whereas the
 * detector's response scale does not track seed extent, so the dish radius is
 * the only stable size reference.
 */
const BOX_SIDE_FRACTION = 0.025;

export function initialBoxSide(dishRadius: number): number {
  return dishRadius * BOX_SIDE_FRACTION;
}

export function initialBoxFromDetection(
  detection: Pick<SeedDetection, "x" | "y">,
  dishRadius: number,
  image: ImageSize,
): BoundingBox | null {
  return boxAround(detection, initialBoxSide(dishRadius), image);
}

export function instanceFromBox(bbox: BoundingBox): SeedInstance {
  return { id: newInstanceId(), class: "seed", bbox };
}

export function documentFromResult(
  result: SeedResult,
  runId: string,
): AnnotationDocument {
  const image = result.image;
  const instances: SeedInstance[] = [];
  for (const detection of result.detections) {
    const bbox = initialBoxFromDetection(detection, result.dish.radius, image);
    if (bbox) {
      instances.push(instanceFromBox(bbox));
    }
  }
  return {
    image: { path: result.source, width: image.width, height: image.height },
    source: {
      runId,
      pipelineFingerprint: result.pipeline.fingerprint,
      modelFingerprint: result.model.fingerprint,
    },
    status: "in_progress",
    revision: 0,
    instances,
  };
}
