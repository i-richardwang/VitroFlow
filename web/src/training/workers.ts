import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";

export const trainingWorkerIdentitySchema = z.strictObject({
  workerId: resourceIdSchema,
  sessionId: resourceIdSchema,
});

export const trainingWorkerHeartbeatSchema =
  trainingWorkerIdentitySchema.extend({
    startedAt: z.string().datetime({ offset: true }),
    device: z.string().min(1),
    /** Memory the accelerator offers a training process. */
    memoryBytes: z.number().int().positive(),
    currentTrainingRunId: resourceIdSchema.nullable(),
  });

export const trainingWorkerRecordSchema = trainingWorkerHeartbeatSchema.extend({
  lastSeenAt: z.string().datetime({ offset: true }),
});

export type TrainingWorkerHeartbeat = z.infer<
  typeof trainingWorkerHeartbeatSchema
>;
export type TrainingWorkerIdentity = z.infer<
  typeof trainingWorkerIdentitySchema
>;
export type TrainingWorkerRecord = z.infer<typeof trainingWorkerRecordSchema>;
