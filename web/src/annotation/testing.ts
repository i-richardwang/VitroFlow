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
    pipeline: { name: "test-pipeline", fingerprint: "a".repeat(64) },
    model: { name: "m", fingerprint: "b".repeat(64) },
    config: {
      geometry: { reference_radius_fraction: 0.6, search_radius_fraction: 0.9 },
      proposals: {
        minimum_scale_fraction: 0.0025,
        maximum_scale_fraction: 0.008,
        scale_levels: 6,
      },
      decision: {
        confidence_threshold: 0.5,
        duplicate_distance_scale: 1.5,
      },
      rendering: { region_radius_fraction: 0.02 },
      quality: {
        maximum_clipped_fraction: 0.02,
        minimum_focus_score: 12,
      },
    },
    detections: detections.map((detection) => ({
      ...detection,
      scale: 9,
      score: 0.9,
    })),
  };
}
