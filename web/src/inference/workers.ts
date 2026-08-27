import { z } from "zod";

import { DATASET_NAME, imageRefSchema } from "../datasets/schema";
import {
  fingerprintSchema,
  runtimeDescriptorSchema,
  versionIdSchema,
} from "./schema";

export const heartbeatSchema = z
  .object({
    workerId: z.string().regex(DATASET_NAME),
    startedAt: z.string().datetime({ offset: true }),
    deployment: z.strictObject({
      modelVersionId: versionIdSchema,
      artifactDigest: fingerprintSchema,
    }),
    runtime: runtimeDescriptorSchema,
    current: imageRefSchema.nullable(),
  })
  .strict();

export const workerSchema = heartbeatSchema
  .extend({ lastSeenAt: z.string().datetime() })
  .strict();

export type InferenceWorkerHeartbeat = z.infer<typeof heartbeatSchema>;
export type InferenceWorkerRecord = z.infer<typeof workerSchema>;
