import { z } from "zod";
import {
  annotationInstanceSchema,
  annotationRefSchema,
  annotationSchema,
  boundingBoxSchema,
} from "../annotation/schema";
import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import { annotationConfigSchema } from "../models/annotation";

export const annotationRuntimeNameSchema = z.enum(["pi", "antigravity"]);
export type AnnotationRuntimeName = z.infer<typeof annotationRuntimeNameSchema>;

export const annotationRuntimeSchema = z.strictObject({
  runtime: annotationRuntimeNameSchema,
  version: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
});
export type AnnotationRuntime = z.infer<typeof annotationRuntimeSchema>;

const annotationExecutorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("interactive") }),
  z.strictObject({
    kind: z.literal("worker"),
    runtime: annotationRuntimeNameSchema,
  }),
]);
export type AnnotationExecutor = z.infer<typeof annotationExecutorSchema>;

export const ANNOTATION_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const startAnnotationRunSchema = z.strictObject({
  id: resourceIdSchema,
  ref: annotationRefSchema,
  executor: annotationExecutorSchema,
  input: z.array(annotationInstanceSchema).max(10000).nullable(),
});
export type StartAnnotationRun = z.infer<typeof startAnnotationRunSchema>;
const annotationProgressSchema = z
  .strictObject({
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .refine((v) => v.completed <= v.total, "Completed exceeds total");

export const annotationDefinitionSchema = z.strictObject({
  image: z.strictObject({
    digest: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  input: z.array(annotationInstanceSchema).nullable(),
  config: annotationConfigSchema,
});
export type AnnotationDefinition = z.infer<typeof annotationDefinitionSchema>;

export const annotationJobSchema = z.strictObject({
  id: resourceIdSchema,
  runtime: annotationRuntimeNameSchema,
});

export const annotationRunResultSchema = z.strictObject({
  document: annotationSchema,
  issues: z.array(
    z.strictObject({
      bbox: boundingBoxSchema,
      reason: z.string().min(1).max(2000),
    }),
  ),
  warnings: z.array(z.string().max(2000)),
  uncertainIds: z.array(z.string().min(1)),
});
export type AnnotationRunResult = z.infer<typeof annotationRunResultSchema>;
export type AnnotationRun = {
  id: string;
  ref: z.infer<typeof annotationRefSchema>;
  requestedBy: string | null;
  executor: AnnotationExecutor;
  runtime: AnnotationRuntime | null;
  status: (typeof ANNOTATION_RUN_STATUSES)[number];
  progress: z.infer<typeof annotationProgressSchema>;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  result: AnnotationRunResult | null;
};

export const annotationProposalSchema = z.strictObject({
  runId: resourceIdSchema,
  executor: annotationExecutorSchema,
  createdAt: z.string(),
  document: annotationSchema,
  issues: annotationRunResultSchema.shape.issues,
  uncertainIds: annotationRunResultSchema.shape.uncertainIds,
});
export type AnnotationProposal = z.infer<typeof annotationProposalSchema>;
export const annotationActivitySchema = z.strictObject({
  runId: resourceIdSchema,
  executor: annotationExecutorSchema,
  status: z.enum(["queued", "running", "failed"]),
  progress: annotationProgressSchema,
  error: z.string().nullable(),
});
export type AnnotationActivity = z.infer<typeof annotationActivitySchema>;
