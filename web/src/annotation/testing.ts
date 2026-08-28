import type { PrelabelResult } from "../detection/schema";
import { boxAround } from "./geometry";

export function makeResult(
  detections: { id: number; x: number; y: number }[],
  {
    digest = "0".repeat(64),
    dishRadius = 2000,
    width = 4000,
    height = 3000,
  } = {},
): PrelabelResult {
  const image = { digest, width, height };
  const side = dishRadius * 0.025;
  return {
    schema_version: 1,
    image,
    producer: {
      model_version_id: "test.traditional-v1",
      artifact_digest: "a".repeat(64),
      runtime: {
        adapter: "traditional",
        fingerprint: "b".repeat(64),
      },
    },
    quality: { status: "ok", warnings: [] },
    diagnostics: {
      dish: { center_x: 2000, center_y: 1500, radius: dishRadius },
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
              class: "seed" as const,
              bbox,
              score: 0.9,
            },
          ]
        : [];
    }),
  };
}
