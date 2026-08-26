import { z } from "zod";

import { boundingBoxSchema } from "../annotation/schema";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const versionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

export const prelabelerDescriptorSchema = z.strictObject({
  version_id: versionId,
  name: z.string().min(1),
  kind: versionId,
  fingerprint,
});

export const seedQualitySchema = z.strictObject({
  status: z.enum(["ok", "review_required"]),
  warnings: z.array(
    z.enum(["dish_detection_failed", "exposure_clipping", "low_focus"]),
  ),
});

const prelabelInstanceSchema = z.strictObject({
  id: z.string().min(1),
  class: z.literal("seed"),
  bbox: boundingBoxSchema,
  score: z.number().finite(),
});

const dishSchema = z.strictObject({
  center_x: z.number().finite(),
  center_y: z.number().finite(),
  radius: z.number().positive(),
});

const diagnosticsSchema = z.strictObject({
  dish: dishSchema.optional(),
  metrics: z.record(z.string(), z.number().finite()).optional(),
});

export const resultSchema = z
  .strictObject({
    schema_version: z.literal(1),
    source: z.string().min(1),
    image: z.strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    producer: prelabelerDescriptorSchema,
    instances: z.array(prelabelInstanceSchema),
    quality: seedQualitySchema,
    diagnostics: diagnosticsSchema.optional(),
  })
  .superRefine((result, context) => {
    const ids = new Set<string>();
    result.instances.forEach((instance, index) => {
      if (ids.has(instance.id)) {
        context.addIssue({
          code: "custom",
          path: ["instances", index, "id"],
          message: `Duplicate instance id: ${instance.id}`,
        });
      }
      ids.add(instance.id);
      const { x, y, width, height } = instance.bbox;
      if (
        x < 0 ||
        y < 0 ||
        x + width > result.image.width ||
        y + height > result.image.height
      ) {
        context.addIssue({
          code: "custom",
          path: ["instances", index, "bbox"],
          message: "Prelabel bounding box exceeds image bounds",
        });
      }
    });
  });

export const failureSchema = z.strictObject({
  schema_version: z.literal(1),
  source: z.string().min(1),
  producer: prelabelerDescriptorSchema,
  error: z.string().min(1).max(2000),
});

export const prelabelSchema = z.union([resultSchema, failureSchema]);

export type PrelabelerDescriptor = z.infer<typeof prelabelerDescriptorSchema>;
export type PrelabelResult = z.infer<typeof resultSchema>;
export type SeedQuality = z.infer<typeof seedQualitySchema>;
export type SeedWarning = SeedQuality["warnings"][number];
export type PrelabelFailure = z.infer<typeof failureSchema>;
export type Prelabel = z.infer<typeof prelabelSchema>;

export function isFailure(prelabel: Prelabel): prelabel is PrelabelFailure {
  return "error" in prelabel;
}

/* Read-only compatibility contract for prelabels written before schema v1. */
const legacyPipelineSchema = z.strictObject({
  name: z.string().min(1),
  fingerprint,
});

const legacyModelSchema = z.strictObject({
  name: z.string().min(1),
  fingerprint,
});

const legacyConfigSchema = z.object({}).passthrough();

const legacyBaseSchema = z.strictObject({
  source: z.string().min(1),
  pipeline: legacyPipelineSchema,
  model: legacyModelSchema,
  config: legacyConfigSchema,
});

export const legacyResultSchema = legacyBaseSchema.extend({
  image: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  count: z.number().int().nonnegative(),
  quality: z.strictObject({
    status: z.enum(["ok", "review_required"]),
    warnings: seedQualitySchema.shape.warnings,
    clipped_fraction: z.number().min(0).max(1),
    focus_score: z.number().nonnegative(),
  }),
  dish: dishSchema,
  detections: z.array(
    z.strictObject({
      id: z.number().int().nonnegative(),
      x: z.number().finite(),
      y: z.number().finite(),
      scale: z.number().positive(),
      score: z.number().finite(),
    }),
  ),
});

export const legacyFailureSchema = legacyBaseSchema.extend({
  error: z.string().min(1).max(2000),
});

export const legacyPrelabelSchema = z.union([
  legacyResultSchema,
  legacyFailureSchema,
]);

export type LegacyPrelabel = z.infer<typeof legacyPrelabelSchema>;
