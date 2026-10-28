import { z } from "zod";
import { workerSessionSchema } from "../workers/schema";
import { inferenceTargetSchema } from "./assignments";

export const inferenceAttemptOwnerSchema = workerSessionSchema.extend({
  attempt: z.number().int().positive(),
});
export type InferenceAttemptOwner = z.infer<
  typeof inferenceAttemptOwnerSchema
> & { workerId: string };
export const inferenceFailureSchema = z.strictObject({
  code: z.enum([
    "transport",
    "execution",
    "invalid_input",
    "interrupted",
    "timeout",
    "lease_expired",
    "session_replaced",
  ]),
  message: z.string().min(1).max(2000),
});
export type InferenceFailure = z.infer<typeof inferenceFailureSchema>;
export const inferenceTaskFailureSchema = inferenceTargetSchema.extend({
  error: z.string(),
});
export const inferenceTaskSchema = inferenceTargetSchema.extend({
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  attempt: z.number().int().nonnegative(),
  attemptsInCycle: z.number().int().nonnegative(),
  availableAt: z.iso.datetime(),
  error: z.string().nullable(),
  attempts: z.array(
    z.strictObject({
      attempt: z.number().int().positive(),
      workerId: z.string(),
      sessionId: z.string(),
      startedAt: z.iso.datetime(),
      deadlineAt: z.iso.datetime(),
      leaseExpiresAt: z.iso.datetime(),
      finishedAt: z.iso.datetime().nullable(),
      status: z.enum(["running", "succeeded", "failed"]),
      failure: inferenceFailureSchema.nullable(),
    }),
  ),
});
