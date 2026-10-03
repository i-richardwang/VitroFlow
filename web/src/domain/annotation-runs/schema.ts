import { z } from "zod";
import {
  annotationInstanceSchema,
  annotationRefSchema,
  annotationSchema,
  boundingBoxSchema,
  REVIEW_SOURCES,
} from "../annotation/schema";
import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import { annotationConfigSchema } from "../models/annotation";
import { imageCoverageSchema } from "../images/coverage";

/** The agent a Worker runs, as it reported itself when the Worker started. */
export const annotationRuntimeSchema = z.strictObject({
  runtime: z.enum(["pi", "antigravity"]),
  version: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
});
export type AnnotationRuntime = z.infer<typeof annotationRuntimeSchema>;

/**
 * Who drives a run: a Worker the workbench dispatches it to, or an agent the
 * person connected over MCP that drives it from its own conversation.
 */
export const ANNOTATION_EXECUTORS = ["worker", "interactive"] as const;
export type AnnotationExecutor = (typeof ANNOTATION_EXECUTORS)[number];

export const ANNOTATION_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
/**
 * The boxes a run begins from: none, a complete list the caller supplies, or
 * one of the image's readings as it stands when the run is admitted.
 */
export const annotationInputSchema = z.union([
  z.array(annotationInstanceSchema).max(10000),
  z.enum(REVIEW_SOURCES),
  z.null(),
]);

/**
 * The part of the image a run redraws, as boxes in source pixels. A run is
 * scoped to the regions those boxes touch; the regions outside keep the
 * boxes the run began from. Null redraws the whole image.
 */
export const annotationScopeSchema = z
  .array(boundingBoxSchema)
  .min(1)
  .max(64)
  .nullable();

export const startAnnotationRunSchema = z.strictObject({
  ref: annotationRefSchema,
  input: annotationInputSchema,
  scope: annotationScopeSchema,
});
export type StartAnnotationRun = z.infer<typeof startAnnotationRunSchema>;
const annotationProgressSchema = z
  .strictObject({
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .refine((v) => v.completed <= v.total, "Completed exceeds total");

/** Questions that remain attached to the boxes and areas an agent has read. */
const annotationNotesSchema = z.strictObject({
  issues: z.array(
    z.strictObject({
      bbox: boundingBoxSchema,
      reason: z.string().min(1).max(2000),
    }),
  ),
  uncertainIds: z.array(z.string().min(1)),
});

export const annotationDefinitionSchema = z.strictObject({
  image: z.strictObject({
    digest: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  input: z.array(annotationInstanceSchema).nullable(),
  inputNotes: annotationNotesSchema.optional(),
  scope: annotationScopeSchema,
  config: annotationConfigSchema,
  coverage: imageCoverageSchema.nullable(),
});
export type AnnotationDefinition = z.infer<typeof annotationDefinitionSchema>;

export const annotationJobSchema = z.strictObject({ id: resourceIdSchema });

const annotationContentSchema = z.strictObject({
  document: annotationSchema,
  ...annotationNotesSchema.shape,
});
export type AnnotationContent = z.infer<typeof annotationContentSchema>;

export const annotationRunResultSchema = annotationContentSchema.extend({
  warnings: z.array(z.string().max(2000)),
});
export type AnnotationRunResult = z.infer<typeof annotationRunResultSchema>;
export type AnnotationRun = {
  id: string;
  status: (typeof ANNOTATION_RUN_STATUSES)[number];
  progress: z.infer<typeof annotationProgressSchema>;
};

export const annotationProposalSchema = annotationRunResultSchema.extend({
  createdAt: z.string(),
});
export type AnnotationProposal = z.infer<typeof annotationProposalSchema>;
export const annotationActivitySchema = z.strictObject({
  status: z.enum(["queued", "running", "failed"]),
  progress: annotationProgressSchema,
});
export type AnnotationActivity = z.infer<typeof annotationActivitySchema>;

export interface AnnotationBatchResult {
  started: number;
  skipped: number;
  failed: Array<{ ref: z.infer<typeof annotationRefSchema>; message: string }>;
}
