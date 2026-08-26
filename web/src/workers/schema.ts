import { z } from "zod";

import { DATASET_NAME, imageRefSchema } from "../datasets/schema";
import { prelabelerDescriptorSchema } from "../prelabelers/schema";
import { versionIdSchema } from "../prelabelers/schema";

export const heartbeatSchema = z
  .object({
    workerId: z.string().regex(DATASET_NAME),
    startedAt: z.string().datetime({ offset: true }),
    modelId: versionIdSchema,
    prelabeler: prelabelerDescriptorSchema,
    current: imageRefSchema.nullable(),
  })
  .strict();

export const workerSchema = heartbeatSchema
  .extend({ lastSeenAt: z.string().datetime() })
  .strict();

export const WORKER_PRESENCES = ["online", "stale", "offline"] as const;

export type WorkerHeartbeat = z.infer<typeof heartbeatSchema>;
export type WorkerRecord = z.infer<typeof workerSchema>;
export type WorkerPresence = (typeof WORKER_PRESENCES)[number];
