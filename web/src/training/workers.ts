import { z } from "zod";

import { versionIdSchema } from "../inference/schema";

export const trainingWorkerHeartbeatSchema = z.strictObject({
  workerId: versionIdSchema,
  startedAt: z.string().datetime({ offset: true }),
  device: z.string().min(1),
  /** Memory the accelerator offers a training process. */
  memoryBytes: z.number().int().positive(),
  currentTrainingRunId: versionIdSchema.nullable(),
});

export const trainingWorkerRecordSchema = trainingWorkerHeartbeatSchema.extend({
  lastSeenAt: z.string().datetime({ offset: true }),
});

export type TrainingWorkerHeartbeat = z.infer<
  typeof trainingWorkerHeartbeatSchema
>;
export type TrainingWorkerRecord = z.infer<typeof trainingWorkerRecordSchema>;
