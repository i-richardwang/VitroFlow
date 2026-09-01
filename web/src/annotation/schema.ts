import { z } from "zod";

import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { runtimeDescriptorSchema } from "../inference/schema";
import { classNameSchema } from "../models/metrics";

export const REVIEW_STATUSES = ["in_progress", "complete", "excluded"] as const;

/**
 * An annotation is addressed by the image and model it describes. The same
 * image annotated for two models has two documents; opening it from an
 * experiment or a dataset reaches the same document.
 */
export const annotationRefSchema = z.strictObject({
  digest: imageDigestSchema,
  modelId: resourceIdSchema,
});

export type AnnotationRef = z.infer<typeof annotationRefSchema>;

export const boundingBoxSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
});

/** One box a reviewer keeps, with the class the model's task defines. */
const annotationInstanceSchema = z.strictObject({
  id: z.string().min(1),
  class: classNameSchema,
  bbox: boundingBoxSchema,
});

export const annotationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    image: z.strictObject({
      digest: imageDigestSchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    source: z.strictObject({
      modelVersionId: resourceIdSchema,
      artifactDigest: sha256Schema,
      runtime: runtimeDescriptorSchema,
    }),
    status: z.enum(REVIEW_STATUSES),
    excludedReason: z.string().min(1).optional(),
    revision: z.number().int().nonnegative(),
    instances: z.array(annotationInstanceSchema),
  })
  .superRefine((document, context) => {
    if (
      document.status !== "excluded" &&
      document.excludedReason !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["excludedReason"],
        message: "Only excluded images can have an exclusion reason",
      });
    }
    const ids = new Set<string>();
    document.instances.forEach((instance, index) => {
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
        x + width > document.image.width ||
        y + height > document.image.height
      ) {
        context.addIssue({
          code: "custom",
          path: ["instances", index, "bbox"],
          message: "Bounding box exceeds image bounds",
        });
      }
    });
  });

export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type AnnotationInstance = z.infer<typeof annotationInstanceSchema>;
export type AnnotationDocument = z.infer<typeof annotationSchema>;
export type ReviewStatus = AnnotationDocument["status"];
export type ImageSize = Pick<AnnotationDocument["image"], "width" | "height">;

export function newInstanceId(): string {
  return crypto.randomUUID();
}
