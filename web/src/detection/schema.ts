import { z } from "zod";

import { boundingBoxSchema } from "../annotation/schema";
import { imageDigestSchema } from "../datasets/schema";
import { predictionProducerSchema } from "../inference/schema";

const warningCodeSchema = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);

const seedQualitySchema = z.strictObject({
  status: z.enum(["ok", "review_required"]),
  warnings: z.array(warningCodeSchema),
});

const prelabelInstanceSchema = z.strictObject({
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

const resultSchema = z
  .strictObject({
    schema_version: z.literal(1),
    image: z.strictObject({
      digest: imageDigestSchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    producer: predictionProducerSchema,
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

const failureSchema = z.strictObject({
  schema_version: z.literal(1),
  image: z.strictObject({ digest: imageDigestSchema }),
  producer: predictionProducerSchema,
  error: z.string().min(1).max(2000),
});

export const prelabelSchema = z.union([resultSchema, failureSchema]);

export type PrelabelResult = z.infer<typeof resultSchema>;
export type SeedQuality = z.infer<typeof seedQualitySchema>;
export type PrelabelFailure = z.infer<typeof failureSchema>;
export type Prelabel = z.infer<typeof prelabelSchema>;

export function isFailure(prelabel: Prelabel): prelabel is PrelabelFailure {
  return "error" in prelabel;
}
