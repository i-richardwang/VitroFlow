import { and, desc, eq, gte, lt, or } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import { inferenceWorkers } from "../db/schema";
import {
  workerSchema,
  type InferenceWorkerHeartbeat,
  type InferenceWorkerIdentity,
  type InferenceWorkerRecord,
} from "../inference/workers";
import { supportsRuntime, type ModelArtifact } from "../models/schema";
import {
  WORKER_FORGET_SECONDS,
  workerPresence,
  type WorkerPresence,
} from "../workers/presence";
import { readModelVersion } from "./model-registry";

export class InferenceHeartbeatRejectedError extends Error {}
export class InferenceWorkerSessionConflictError extends Error {}

/** Whether one of the worker's runtimes executes this artifact. */
export function canExecute(
  worker: Pick<InferenceWorkerRecord, "runtimes">,
  artifact: ModelArtifact,
): boolean {
  return worker.runtimes.some((runtime) => supportsRuntime(artifact, runtime));
}

/**
 * A worker heartbeats while polling for work and before every image it
 * processes; presence is derived from the heartbeat age.
 */
function toRecord(
  row: typeof inferenceWorkers.$inferSelect,
): InferenceWorkerRecord {
  return workerSchema.parse({
    workerId: row.id,
    sessionId: row.sessionId,
    startedAt: row.startedAt.toISOString(),
    runtimes: row.runtimes,
    loaded: row.loadedModelVersionId,
    current: row.currentImageId,
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
  if (worker.loaded) {
    const version = await readModelVersion(worker.loaded, db);
    if (!version) {
      throw new InferenceHeartbeatRejectedError(
        `Unknown model version: ${worker.loaded}`,
      );
    }
    if (!canExecute(worker, version.artifact)) {
      throw new InferenceHeartbeatRejectedError(
        "Inference runtimes cannot execute the loaded version",
      );
    }
  }
  const row = {
    sessionId: worker.sessionId,
    startedAt: new Date(worker.startedAt),
    runtimes: worker.runtimes,
    loadedModelVersionId: worker.loaded,
    currentImageId: worker.current,
    lastSeenAt: at,
  };
  const [stored] = await db
    .insert(inferenceWorkers)
    .values({ id: worker.workerId, ...row })
    .onConflictDoUpdate({
      target: inferenceWorkers.id,
      set: row,
      setWhere: or(
        eq(inferenceWorkers.sessionId, worker.sessionId),
        lt(inferenceWorkers.startedAt, new Date(worker.startedAt)),
      ),
    })
    .returning();
  if (!stored) {
    throw new InferenceWorkerSessionConflictError(
      `Worker ${worker.workerId} has a newer active session`,
    );
  }
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

export async function readInferenceWorkerSession(
  identity: InferenceWorkerIdentity,
  db?: Executor,
): Promise<InferenceWorkerRecord | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(inferenceWorkers)
    .where(
      and(
        eq(inferenceWorkers.id, identity.workerId),
        eq(inferenceWorkers.sessionId, identity.sessionId),
      ),
    );
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
