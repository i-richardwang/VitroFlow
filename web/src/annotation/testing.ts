import type { DetectionResult } from "../detection/schema";
import { boxAround } from "./geometry";

export function makeResult(
  detections: { id: number; x: number; y: number }[],
  {
    digest = "0".repeat(64),
    dishRadius = 2000,
    width = 4000,
    height = 3000,
  } = {},
): DetectionResult {
  const image = { digest, width, height };
  const side = dishRadius * 0.025;
  return {
    schemaVersion: 1,
    image,
    producer: {
      modelVersionId: "test.traditional-v1",
      artifactDigest: "a".repeat(64),
      runtime: {
        adapter: "traditional",
        fingerprint: "b".repeat(64),
      },
    },
    quality: { status: "ok", warnings: [] },
    diagnostics: {
      dish: { centerX: 2000, centerY: 1500, radius: dishRadius },
      metrics: {
        confidence_threshold: 0.5,
        clipped_fraction: 0,
        focus_score: 1,
      },
    },
    instances: detections.flatMap((detection) => {
      const bbox = boxAround(detection, side, image);
      return bbox
        ? [
            {
              id: String(detection.id),
              class: "seed",
              bbox,
              score: 0.9,
            },
          ]
        : [];
    }),
  };
}
