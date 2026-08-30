import { z } from "zod";

import { boundingBoxSchema } from "../annotation/schema";
import { imageDigestSchema } from "../datasets/schema";
import { detectionProducerSchema } from "../inference/schema";

const warningCodeSchema = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);

const seedQualitySchema = z.strictObject({
  status: z.enum(["ok", "review_required"]),
  warnings: z.array(warningCodeSchema),
});

const detectionInstanceSchema = z.strictObject({
  id: z.string().min(1),
  class: z.literal("seed"),
  bbox: boundingBoxSchema,
  score: z.number().finite().min(0).max(1),
});

const dishSchema = z.strictObject({
  center_x: z.number().finite(),
  center_y: z.number().finite(),
  radius: z.number().positive(),
});

const diagnosticsSchema = z.strictObject({
  dish: dishSchema.optional(),
  metrics: z.record(z.string().min(1), z.number().finite()).optional(),
});

/**
 * What one model version found in one image. The producer records the
 * version, its artifact, and the runtime that executed it; the image block
 * repeats the dimensions the boxes are expressed in.
 */
export const detectionResultSchema = z
  .strictObject({
    schema_version: z.literal(1),
    image: z.strictObject({
      digest: imageDigestSchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    producer: detectionProducerSchema,
    instances: z.array(detectionInstanceSchema),
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
          message: "Detection bounding box exceeds image bounds",
        });
      }
    });
  });

/** Why one attempt failed before it could produce a valid detection result. */
export const detectionFailureSchema = z.strictObject({
  schema_version: z.literal(1),
  image: z.strictObject({ digest: imageDigestSchema }),
  producer: detectionProducerSchema,
  error: z.string().min(1).max(2000),
});

/** Everything an Inference Worker reports back for one image. */
export const inferenceOutcomeSchema = z.union([
  detectionResultSchema,
  detectionFailureSchema,
]);

export type DetectionResult = z.infer<typeof detectionResultSchema>;
export type SeedQuality = z.infer<typeof seedQualitySchema>;
export type DetectionFailure = z.infer<typeof detectionFailureSchema>;
export type InferenceOutcome = z.infer<typeof inferenceOutcomeSchema>;

export function isFailure(
  outcome: InferenceOutcome,
): outcome is DetectionFailure {
  return "error" in outcome;
}
