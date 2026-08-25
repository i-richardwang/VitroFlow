import { z } from "zod";

const REVIEW_STATUSES = ["in_progress", "complete", "excluded"] as const;

/** Every state an image can be in, including having no label file yet. */
export const REVIEW_STATES = ["uninitialized", ...REVIEW_STATUSES] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

const boundingBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const seedInstanceSchema = z.object({
  id: z.string().min(1),
  class: z.literal("seed"),
  bbox: boundingBoxSchema,
});

export const annotationSchema = z
  .object({
    image: z.object({
      path: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    source: z.object({
      runId: z.string().min(1),
      modelFingerprint: z.string().min(1),
    }),
    status: z.enum(REVIEW_STATUSES),
    excludedReason: z.string().optional(),
    revision: z.number().int().nonnegative(),
    instances: z.array(seedInstanceSchema),
  })
  .superRefine((document, context) => {
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
export type SeedInstance = z.infer<typeof seedInstanceSchema>;
export type AnnotationDocument = z.infer<typeof annotationSchema>;
export type ReviewStatus = AnnotationDocument["status"];
export type ImageSize = Pick<AnnotationDocument["image"], "width" | "height">;

export function newInstanceId(): string {
  return crypto.randomUUID();
}
