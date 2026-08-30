import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { runtimeDescriptorSchema } from "./schema";

/** The adapters one process can execute, each at most once. */
const runtimesSchema = z
  .array(runtimeDescriptorSchema)
  .min(1)
  .refine(
    (runtimes) =>
      new Set(runtimes.map((runtime) => runtime.adapter)).size ===
      runtimes.length,
    "each adapter appears once",
  );

export const heartbeatSchema = z
  .object({
    workerId: resourceIdSchema,
    startedAt: z.string().datetime({ offset: true }),
    runtimes: runtimesSchema,
    /** The version held in memory, if any. */
    loaded: resourceIdSchema.nullable(),
    /** The image being processed, if any. */
    current: imageDigestSchema.nullable(),
  })
  .strict();

export const workerSchema = heartbeatSchema
  .extend({ lastSeenAt: z.string().datetime() })
  .strict();

export type InferenceWorkerHeartbeat = z.infer<typeof heartbeatSchema>;
export type InferenceWorkerRecord = z.infer<typeof workerSchema>;
