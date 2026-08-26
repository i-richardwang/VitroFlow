import type { PrelabelResult } from "../detection/schema";
import { boxAround } from "./geometry";

export function makeResult(
  detections: { id: number; x: number; y: number }[],
  dishRadius = 2000,
): PrelabelResult {
  const image = { width: 4000, height: 3000 };
  const side = dishRadius * 0.025;
  return {
    schema_version: 1,
    source: "images/a.jpg",
    image,
    producer: {
      version_id: "traditional-v1",
      name: "m",
      kind: "traditional",
      fingerprint: "b".repeat(64),
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
