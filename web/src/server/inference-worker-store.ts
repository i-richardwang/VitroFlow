import { desc, eq, gte, lt } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import { inferenceWorkers } from "../db/schema";
import {
  workerSchema,
  type InferenceWorkerHeartbeat,
  type InferenceWorkerRecord,
} from "../inference/workers";
import { supportsRuntime } from "../models/schema";
import {
  WORKER_FORGET_SECONDS,
  workerPresence,
  type WorkerPresence,
} from "../workers/presence";
import { readModelVersion } from "./model-registry";

/**
 * A worker heartbeats while polling for work and before every image it
 * processes; presence is derived from the heartbeat age.
 */
function toRecord(
  row: typeof inferenceWorkers.$inferSelect,
): InferenceWorkerRecord {
  return workerSchema.parse({
    workerId: row.id,
    startedAt: row.startedAt.toISOString(),
    deployment: {
      modelVersionId: row.modelVersionId,
      artifactDigest: row.artifactDigest,
    },
    runtime: row.runtime,
    current: row.current,
    lastSeenAt: row.lastSeenAt.toISOString(),
  });
}

export async function recordInferenceHeartbeat(
  heartbeat: InferenceWorkerHeartbeat,
  at: Date = new Date(),
): Promise<InferenceWorkerRecord> {
  const worker = workerSchema.parse({
    ...heartbeat,
    lastSeenAt: at.toISOString(),
  });
  const db = await database();
  const version = await readModelVersion(worker.deployment.modelVersionId, db);
  if (!version) {
    throw new Error(
      `Unknown model version: ${worker.deployment.modelVersionId}`,
    );
  }
  if (version.artifact.digest !== worker.deployment.artifactDigest) {
    throw new Error(
      "Inference deployment artifact does not match model version",
    );
  }
  if (!supportsRuntime(version.artifact, worker.runtime)) {
    throw new Error("Inference runtime cannot execute this model artifact");
  }
  const row = {
    startedAt: new Date(worker.startedAt),
    modelVersionId: worker.deployment.modelVersionId,
    artifactDigest: worker.deployment.artifactDigest,
    runtime: worker.runtime,
    current: worker.current,
    lastSeenAt: at,
  };
  const [stored] = await db
    .insert(inferenceWorkers)
    .values({ id: worker.workerId, ...row })
    .onConflictDoUpdate({ target: inferenceWorkers.id, set: row })
    .returning();
  if (!stored) throw new Error(`Worker ${worker.workerId} was not recorded`);
  await forgetSilentWorkers(at, db);
  return toRecord(stored);
}

export async function readInferenceWorker(
  workerId: string,
  db?: Executor,
): Promise<InferenceWorkerRecord | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(inferenceWorkers)
    .where(eq(inferenceWorkers.id, workerId));
  return row ? toRecord(row) : null;
}

function forgetBefore(at: Date): Date {
  return new Date(at.getTime() - WORKER_FORGET_SECONDS * 1000);
}

/** Workers silent for longer than the forget window leave the roster. */
async function forgetSilentWorkers(at: Date, db: Executor): Promise<void> {
  await db
    .delete(inferenceWorkers)
    .where(lt(inferenceWorkers.lastSeenAt, forgetBefore(at)));
}

/** Workers heard from within the forget window, newest first. */
export async function listInferenceWorkers(
  at: Date = new Date(),
): Promise<InferenceWorkerRecord[]> {
  const db = await database();
  const rows = await db
    .select()
    .from(inferenceWorkers)
    .where(gte(inferenceWorkers.lastSeenAt, forgetBefore(at)))
    .orderBy(desc(inferenceWorkers.lastSeenAt));
  return rows.map(toRecord);
}

export function inferenceWorkerPresence(
  worker: InferenceWorkerRecord,
  at: Date = new Date(),
): WorkerPresence {
  return workerPresence(worker.lastSeenAt, at);
}
