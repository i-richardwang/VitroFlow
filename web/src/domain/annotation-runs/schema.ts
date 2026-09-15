import { z } from "zod";
import {
  annotationInstanceSchema,
  annotationRefSchema,
  annotationSchema,
  boundingBoxSchema,
} from "../annotation/schema";
import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import { classListSchema } from "../models/classes";

/** An installed external runtime and the vision model its host selects. */
export const annotationRuntimeNameSchema = z.enum(["pi", "antigravity"]);
export const annotationRuntimeSchema = z.strictObject({
  runtime: annotationRuntimeNameSchema,
  version: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
});
export type AnnotationRuntime = z.infer<typeof annotationRuntimeSchema>;
export const ANNOTATION_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const DEFAULT_ANNOTATION_REGION = {
  coreSize: 512,
  halo: 32,
  displayScale: 2,
};
export const annotationRegionSchema = z
  .strictObject({
    coreSize: z.number().int().min(16).max(2048),
    halo: z.number().int().min(0).max(2048),
    displayScale: z.number().int().min(1).max(4),
  })
  .refine((v) => v.halo <= v.coreSize, "Context cannot exceed core size");
export type AnnotationRegion = z.infer<typeof annotationRegionSchema>;
export const annotationConfigSchema = annotationRegionSchema.safeExtend({
  classes: classListSchema,
  rules: z.string().trim().min(1).max(8000),
});
export const startAnnotationRunSchema = z.strictObject({
  id: resourceIdSchema,
  ref: annotationRefSchema,
  workerId: resourceIdSchema,
  runtime: annotationRuntimeSchema,
  input: z.array(annotationInstanceSchema).max(10000).nullable(),
  base: z.array(annotationInstanceSchema).max(10000).nullable(),
  rules: z.string().trim().min(1).max(8000),
  region: annotationRegionSchema,
});
export type StartAnnotationRun = z.infer<typeof startAnnotationRunSchema>;
export const annotationProgressSchema = z
  .strictObject({
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .refine((v) => v.completed <= v.total, "Completed exceeds total");

/** Product-sized result; full image assets and runtime transcripts stay on the host. */
export const annotationRunResultSchema = z.strictObject({
  document: annotationSchema,
  packageId: sha256Schema,
  checkpointDigests: z.record(z.string(), sha256Schema),
  issues: z
    .array(
      z.strictObject({
        bbox: boundingBoxSchema,
        reason: z.string().min(1).max(2000),
      }),
    )
    .max(10000),
  warnings: z.array(z.string().max(2000)).max(10000),
  uncertainIds: z.array(z.string().min(1)).max(10000),
  execution: annotationRuntimeSchema.extend({
    elapsedSeconds: z.number().nonnegative(),
  }),
});
export type AnnotationRunResult = z.infer<typeof annotationRunResultSchema>;
export const annotationAssignmentSchema = z.strictObject({
  id: resourceIdSchema,
  image: z.strictObject({
    digest: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  input: z.array(annotationInstanceSchema).nullable(),
  config: annotationConfigSchema,
  runtime: annotationRuntimeSchema,
});
export type AnnotationAssignment = z.infer<typeof annotationAssignmentSchema>;
export type AnnotationRun = {
  id: string;
  ref: z.infer<typeof annotationRefSchema>;
  requestedBy: string | null;
  runtime: AnnotationRuntime;
  region: AnnotationRegion;
  status: (typeof ANNOTATION_RUN_STATUSES)[number];
  progress: z.infer<typeof annotationProgressSchema>;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  result: AnnotationRunResult | null;
};

export const SEED_ANNOTATION_RULES = `Annotate each seed body separately, including opaque brown/gold
and pale yellow/translucent bodies with a coherent elongated outline. Enclose the
complete visible body, including pale coat and tips, before minimizing background.
Distinguish seed bodies from fibers and glare. Inspect touching clusters for
separate bodies at different angles; their rectangles may overlap naturally.
Do not force an expected count or mechanically shrink, expand or pad boxes.`;
