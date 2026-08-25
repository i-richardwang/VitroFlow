import { z } from "zod";

const REVIEW_STATUSES = ["in_progress", "complete", "excluded"] as const;

export const REVIEW_STATES = ["uninitialized", ...REVIEW_STATUSES] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

const boundingBoxSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const seedInstanceSchema = z.strictObject({
  id: z.string().min(1),
  class: z.literal("seed"),
  bbox: boundingBoxSchema,
});

export const annotationSchema = z
  .strictObject({
    image: z.strictObject({
      path: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    source: z.strictObject({
      runId: z.string().min(1),
      pipelineFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      modelFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    status: z.enum(REVIEW_STATUSES),
    excludedReason: z.string().optional(),
    revision: z.number().int().nonnegative(),
    instances: z.array(seedInstanceSchema),
  })
  .superRefine((document, context) => {
    if (document.status !== "excluded" && document.excludedReason !== undefined) {
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
export type SeedInstance = z.infer<typeof seedInstanceSchema>;
export type AnnotationDocument = z.infer<typeof annotationSchema>;
export type ReviewStatus = AnnotationDocument["status"];
export type ImageSize = Pick<AnnotationDocument["image"], "width" | "height">;

export function newInstanceId(): string {
  return crypto.randomUUID();
}
