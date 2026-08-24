import { z } from 'zod'

export const resultSchema = z.object({
  source: z.string(),
  image: z.object({ width: z.number(), height: z.number() }),
  count: z.number(),
  quality: z.object({
    status: z.enum(['ok', 'review_required']),
    warnings: z.array(z.enum(['dish_detection_failed', 'exposure_clipping', 'low_focus'])),
    clipped_fraction: z.number(),
    focus_score: z.number(),
  }),
  dish: z.object({
    center_x: z.number(),
    center_y: z.number(),
    radius: z.number(),
  }),
  score_threshold: z.number(),
  config: z.object({
    measurement_radius_fraction: z.number(),
    label_window_fraction: z.number(),
  }),
  detections: z.array(
    z.object({
      id: z.number(),
      x: z.number(),
      y: z.number(),
      score: z.number(),
    }),
  ),
})

const pointSchema = z.object({ x: z.number(), y: z.number() })

export const calibrationEditSchema = z.object({
  removed: z.array(z.number()),
  added: z.array(pointSchema),
})

export const calibrationSchema = z.object({
  image: z.string(),
  run: z.string(),
  count: z.object({ algorithm: z.number(), calibrated: z.number() }),
  removed: z.array(pointSchema.extend({ id: z.number() })),
  added: z.array(pointSchema),
})

export type SeedResult = z.infer<typeof resultSchema>
export type SeedQuality = SeedResult['quality']
export type SeedWarning = SeedQuality['warnings'][number]
export type Point = z.infer<typeof pointSchema>
export type Calibration = z.infer<typeof calibrationSchema>
export type CalibrationEdit = z.infer<typeof calibrationEditSchema>
