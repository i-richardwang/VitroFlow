import { z } from "zod";

export const resultSchema = z.object({
  source: z.string(),
  image: z.object({ width: z.number(), height: z.number() }),
  count: z.number(),
  quality: z.object({
    status: z.enum(["ok", "review_required"]),
    warnings: z.array(
      z.enum(["dish_detection_failed", "exposure_clipping", "low_focus"]),
    ),
    clipped_fraction: z.number(),
    focus_score: z.number(),
  }),
  dish: z.object({
    center_x: z.number(),
    center_y: z.number(),
    radius: z.number(),
  }),
  confidence_threshold: z.number(),
  model: z.object({
    name: z.string(),
    fingerprint: z.string(),
  }),
  config: z.object({
    geometry: z.object({
      reference_radius_fraction: z.number(),
      search_radius_fraction: z.number(),
    }),
    rendering: z.object({ region_radius_fraction: z.number() }),
  }),
  detections: z.array(
    z.object({
      id: z.number(),
      x: z.number(),
      y: z.number(),
      scale: z.number(),
      score: z.number(),
    }),
  ),
});

const pointSchema = z.object({ x: z.number(), y: z.number() });

// A correction records how a detection result differs from the seeds a reviewer sees.
// Each one consumes some detection ids and asserts some seed positions; the calibrated
// count and the training annotations are both derived from that.
export const correctionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("remove"), id: z.number() }),
  z.object({ type: z.literal("add"), point: pointSchema }),
  z.object({
    type: z.literal("merge"),
    ids: z.array(z.number()).min(2),
    point: pointSchema,
  }),
  z.object({
    type: z.literal("split"),
    id: z.number(),
    points: z.array(pointSchema).min(2),
  }),
]);

export const calibrationSchema = z.object({
  image: z.string(),
  run: z.string(),
  count: z.object({ algorithm: z.number(), calibrated: z.number() }),
  corrections: z.array(correctionSchema),
});

export type SeedResult = z.infer<typeof resultSchema>;
export type SeedDetection = SeedResult["detections"][number];
export type SeedQuality = SeedResult["quality"];
export type SeedWarning = SeedQuality["warnings"][number];
export type Point = z.infer<typeof pointSchema>;
export type Correction = z.infer<typeof correctionSchema>;
export type Calibration = z.infer<typeof calibrationSchema>;
