import { z } from "zod";
import {
  annotationInstanceSchema,
  annotationRefSchema,
  annotationSchema,
  boundingBoxSchema,
} from "../annotation/schema";
import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import { annotationConfigSchema } from "../models/annotation";

/** The external agents a Worker can run; each authenticates and picks its model itself. */
export const annotationRuntimeNameSchema = z.enum(["pi", "antigravity"]);
export type AnnotationRuntimeName = z.infer<typeof annotationRuntimeNameSchema>;
/** What a Worker found installed: the agent, its version, and the vision model it selects. */
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
/**
 * A run asks for an agent and a starting point: the image alone, or boxes to
 * refit. The model says what and how to draw.
 */
export const startAnnotationRunSchema = z.strictObject({
  id: resourceIdSchema,
  ref: annotationRefSchema,
  runtime: annotationRuntimeNameSchema,
  input: z.array(annotationInstanceSchema).max(10000).nullable(),
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
/** The frozen task a Worker executes; the model's instructions travel as `rules`. */
export const annotationAssignmentSchema = z.strictObject({
  id: resourceIdSchema,
  image: z.strictObject({
    digest: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  input: z.array(annotationInstanceSchema).nullable(),
  config: annotationConfigSchema,
  runtime: annotationRuntimeNameSchema,
});
export type AnnotationAssignment = z.infer<typeof annotationAssignmentSchema>;
export type AnnotationRun = {
  id: string;
  ref: z.infer<typeof annotationRefSchema>;
  requestedBy: string | null;
  runtime: AnnotationRuntimeName;
  status: (typeof ANNOTATION_RUN_STATUSES)[number];
  progress: z.infer<typeof annotationProgressSchema>;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  result: AnnotationRunResult | null;
};

/**
 * The AI's reading of an image for a model: the newest run that succeeded,
 * reduced to what a page shows. Older runs are records, not readings.
 */
export const annotationProposalSchema = z.strictObject({
  runId: resourceIdSchema,
  agent: annotationRuntimeNameSchema,
  createdAt: z.string(),
  document: annotationSchema,
  issues: annotationRunResultSchema.shape.issues,
  uncertainIds: annotationRunResultSchema.shape.uncertainIds,
});
export type AnnotationProposal = z.infer<typeof annotationProposalSchema>;

/** The newest run while it is still working, or after it failed. */
export const annotationActivitySchema = z.strictObject({
  runId: resourceIdSchema,
  agent: annotationRuntimeNameSchema,
  status: z.enum(["queued", "running", "failed"]),
  progress: annotationProgressSchema,
  error: z.string().nullable(),
});
export type AnnotationActivity = z.infer<typeof annotationActivitySchema>;
