import type { SeedResult } from "../detection/schema";

export function makeResult(
  detections: { id: number; x: number; y: number }[],
  dishRadius = 2000,
): SeedResult {
  return {
    source: "images/a.jpg",
    image: { width: 4000, height: 3000 },
    count: detections.length,
    quality: {
      status: "ok",
      warnings: [],
      clipped_fraction: 0,
      focus_score: 1,
    },
    dish: { center_x: 2000, center_y: 1500, radius: dishRadius },
    confidence_threshold: 0.5,
    model: { name: "m", fingerprint: "abc" },
    config: {
      geometry: { reference_radius_fraction: 0.6, search_radius_fraction: 0.9 },
      rendering: { region_radius_fraction: 0.02 },
    },
    detections: detections.map((detection) => ({
      ...detection,
      scale: 9,
      score: 0.9,
    })),
  };
}
