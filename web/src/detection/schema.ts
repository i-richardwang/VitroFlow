import { z } from "zod";

export const pipelineSchema = z.object({
  name: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const modelSchema = z.object({
  name: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const pipelineConfigSchema = z
  .object({
    geometry: z
      .object({
        reference_radius_fraction: z.number().positive().max(1),
        search_radius_fraction: z.number().positive().max(1),
      })
      .strict(),
    proposals: z
      .object({
        minimum_scale_fraction: z.number().positive(),
        maximum_scale_fraction: z.number().positive(),
        scale_levels: z.number().int().min(2),
      })
      .strict(),
    decision: z
      .object({
        confidence_threshold: z.number().min(0).max(1),
        duplicate_distance_scale: z.number().positive(),
      })
      .strict(),
    rendering: z
      .object({ region_radius_fraction: z.number().positive() })
      .strict(),
    quality: z
      .object({
        maximum_clipped_fraction: z.number().min(0).max(1),
        minimum_focus_score: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.geometry.reference_radius_fraction >
      config.geometry.search_radius_fraction
    ) {
      context.addIssue({
        code: "custom",
        path: ["geometry"],
        message: "Reference radius cannot exceed search radius",
      });
    }
    if (
      config.proposals.minimum_scale_fraction >
      config.proposals.maximum_scale_fraction
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposals"],
        message: "Minimum proposal scale cannot exceed maximum scale",
      });
    }
  });

export const executionSchema = z.object({
  pipeline: pipelineSchema,
  model: modelSchema,
  config: pipelineConfigSchema,
}).strict();

export const resultSchema = z
  .strictObject({
    source: z.string().min(1),
    image: z.strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    count: z.number().int().nonnegative(),
    quality: z.strictObject({
      status: z.enum(["ok", "review_required"]),
      warnings: z.array(
        z.enum(["dish_detection_failed", "exposure_clipping", "low_focus"]),
      ),
      clipped_fraction: z.number().min(0).max(1),
      focus_score: z.number().nonnegative(),
    }),
    dish: z.strictObject({
      center_x: z.number().finite(),
      center_y: z.number().finite(),
      radius: z.number().positive(),
    }),
    pipeline: pipelineSchema,
    model: modelSchema,
    config: pipelineConfigSchema,
    detections: z.array(
      z.strictObject({
        id: z.number().int().nonnegative(),
        x: z.number().finite(),
        y: z.number().finite(),
        scale: z.number().positive(),
        score: z.number().finite(),
      }),
    ),
  })
  .superRefine((result, context) => {
    if (result.count !== result.detections.length) {
      context.addIssue({
        code: "custom",
        path: ["count"],
        message: "Count must equal the number of detections",
      });
    }
    const ids = new Set<number>();
    result.detections.forEach((detection, index) => {
      if (ids.has(detection.id)) {
        context.addIssue({
          code: "custom",
          path: ["detections", index, "id"],
          message: `Duplicate detection id: ${detection.id}`,
        });
      }
      ids.add(detection.id);
      if (
        detection.x < 0 ||
        detection.y < 0 ||
        detection.x >= result.image.width ||
        detection.y >= result.image.height
      ) {
        context.addIssue({
          code: "custom",
          path: ["detections", index],
          message: "Detection center is outside the image",
        });
      }
    });
  });

export type SeedResult = z.infer<typeof resultSchema>;
export type SeedDetection = SeedResult["detections"][number];
export type SeedQuality = SeedResult["quality"];
export type SeedWarning = SeedQuality["warnings"][number];
export type ExecutionIdentity = z.infer<typeof executionSchema>;

export const IMAGE_KINDS = ["source", "overlay", "debug"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];
