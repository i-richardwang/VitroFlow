import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { runtimeDescriptorSchema } from "../inference/schema";

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

/** A worker process: the worker it runs as and the session it runs in. */
export const workerIdentitySchema = z.strictObject({
  workerId: resourceIdSchema,
  sessionId: resourceIdSchema,
});

/** What a process reports while it is alive: who it is and what it can do. */
export const workerHeartbeatSchema = workerIdentitySchema
  .extend({
    startedAt: z.string().datetime({ offset: true }),
    runtimes: runtimesSchema,
    /** Memory the accelerator offers a job. */
    memoryBytes: z.number().int().positive(),
  })
  .strict();

export const workerSchema = workerHeartbeatSchema
  .extend({ lastSeenAt: z.string().datetime({ offset: true }) })
  .strict();

/** What a worker is doing: the lease it holds, named for the workbench. */
export type WorkerActivity =
  | { kind: "inference"; image: string }
  | { kind: "training"; runId: string; dataset: string };

export type WorkerIdentity = z.infer<typeof workerIdentitySchema>;
export type WorkerHeartbeat = z.infer<typeof workerHeartbeatSchema>;
export type Worker = z.infer<typeof workerSchema>;

/** Training runs on the ultralytics runtime; a worker without it only detects. */
export function canTrain(worker: Pick<Worker, "runtimes">): boolean {
  return worker.runtimes.some((runtime) => runtime.adapter === "ultralytics");
}
