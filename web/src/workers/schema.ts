import { z } from "zod";

import { executionSchema } from "../detection/schema";
import { IDENTIFIER } from "../jobs/schema";

export const heartbeatSchema = z
  .object({
    workerId: z.string().regex(IDENTIFIER),
    startedAt: z.string().datetime({ offset: true }),
    execution: executionSchema,
    currentJobId: z.string().uuid().nullable(),
  })
  .strict();

export const workerSchema = heartbeatSchema
  .extend({ lastSeenAt: z.string().datetime() })
  .strict();

export const WORKER_PRESENCES = ["online", "stale", "offline"] as const;

export type WorkerHeartbeat = z.infer<typeof heartbeatSchema>;
export type WorkerRecord = z.infer<typeof workerSchema>;
export type WorkerPresence = (typeof WORKER_PRESENCES)[number];
