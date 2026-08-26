import { z } from "zod";

import { executionSchema } from "../detection/schema";

export const JOB_STATUSES = [
  "queued",
  "running",
  "publishing",
  "succeeded",
  "failed",
] as const;

export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const RUN_ID = /^[a-f0-9]{12}$/;

export const jobImageSchema = z
  .object({
    id: z.string().uuid(),
    source: z.string().min(1),
    stem: z.string().min(1),
  })
  .strict();

const baseJobSchema = z.strictObject({
  id: z.string().uuid(),
  dataset: z.string().regex(IDENTIFIER),
  runId: z.string().regex(RUN_ID),
  images: z.array(jobImageSchema).min(1),
  completedImages: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export const jobSchema = z
  .discriminatedUnion("status", [
    baseJobSchema.extend({ status: z.literal("queued") }).strict(),
    baseJobSchema
      .extend({
        status: z.literal("running"),
        startedAt: z.string().datetime(),
        workerId: z.string().regex(IDENTIFIER),
        execution: executionSchema.optional(),
      })
      .strict(),
    baseJobSchema
      .extend({
        status: z.literal("publishing"),
        startedAt: z.string().datetime(),
        publishingAt: z.string().datetime(),
        execution: executionSchema,
      })
      .strict(),
    baseJobSchema
      .extend({
        status: z.literal("succeeded"),
        startedAt: z.string().datetime(),
        publishingAt: z.string().datetime(),
        finishedAt: z.string().datetime(),
        execution: executionSchema,
      })
      .strict(),
    baseJobSchema
      .extend({
        status: z.literal("failed"),
        startedAt: z.string().datetime(),
        finishedAt: z.string().datetime(),
        error: z.string().min(1).max(2000),
        execution: executionSchema.optional(),
      })
      .strict(),
  ])
  .superRefine((job, context) => {
    if (job.completedImages > job.images.length) {
      context.addIssue({
        code: "custom",
        path: ["completedImages"],
        message: "Completed image count exceeds job size",
      });
    }
    if (
      (job.status === "publishing" || job.status === "succeeded") &&
      job.completedImages !== job.images.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedImages"],
        message: `${job.status} jobs must contain every result`,
      });
    }
  });

export type RecognitionJob = z.infer<typeof jobSchema>;
export type QueuedJob = Extract<RecognitionJob, { status: "queued" }>;
export type RunningJob = Extract<RecognitionJob, { status: "running" }>;
export type PublishingJob = Extract<RecognitionJob, { status: "publishing" }>;
export type SucceededJob = Extract<RecognitionJob, { status: "succeeded" }>;
export type JobImage = z.infer<typeof jobImageSchema>;
export type JobStatus = RecognitionJob["status"];
