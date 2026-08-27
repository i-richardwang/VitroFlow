import { desc, eq, gte, lt } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import { trainingWorkers } from "../db/schema";
import {
  trainingWorkerHeartbeatSchema,
  trainingWorkerRecordSchema,
  type TrainingWorkerHeartbeat,
  type TrainingWorkerRecord,
} from "../training/workers";
import {
  WORKER_FORGET_SECONDS,
  workerPresence,
  type WorkerPresence,
} from "../workers/presence";

function toRecord(
  row: typeof trainingWorkers.$inferSelect,
): TrainingWorkerRecord {
  return trainingWorkerRecordSchema.parse({
    workerId: row.id,
    startedAt: row.startedAt.toISOString(),
    device: row.device,
    currentTrainingRunId: row.currentTrainingRunId,
    lastSeenAt: row.lastSeenAt.toISOString(),
  });
}

export async function recordTrainingHeartbeat(
  value: TrainingWorkerHeartbeat,
  at: Date = new Date(),
): Promise<TrainingWorkerRecord> {
  const heartbeat = trainingWorkerHeartbeatSchema.parse(value);
  const record = trainingWorkerRecordSchema.parse({
    ...heartbeat,
    lastSeenAt: at.toISOString(),
  });
  const row = {
    startedAt: new Date(record.startedAt),
    device: record.device,
    currentTrainingRunId: record.currentTrainingRunId,
    lastSeenAt: at,
  };
  const db = await database();
  const [stored] = await db
    .insert(trainingWorkers)
    .values({ id: record.workerId, ...row })
    .onConflictDoUpdate({ target: trainingWorkers.id, set: row })
    .returning();
  if (!stored) throw new Error(`Worker ${record.workerId} was not recorded`);
  await forgetSilentWorkers(at, db);
  return toRecord(stored);
}

export async function readTrainingWorker(
  workerId: string,
  db?: Executor,
): Promise<TrainingWorkerRecord | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(trainingWorkers)
    .where(eq(trainingWorkers.id, workerId));
  return row ? toRecord(row) : null;
}

function forgetBefore(at: Date): Date {
  return new Date(at.getTime() - WORKER_FORGET_SECONDS * 1000);
}

/** Workers silent for longer than the forget window leave the roster. */
async function forgetSilentWorkers(at: Date, db: Executor): Promise<void> {
  await db
    .delete(trainingWorkers)
    .where(lt(trainingWorkers.lastSeenAt, forgetBefore(at)));
}

/** Workers heard from within the forget window, newest first. */
export async function listTrainingWorkers(
  at: Date = new Date(),
): Promise<TrainingWorkerRecord[]> {
  const db = await database();
  const rows = await db
    .select()
    .from(trainingWorkers)
    .where(gte(trainingWorkers.lastSeenAt, forgetBefore(at)))
    .orderBy(desc(trainingWorkers.lastSeenAt));
  return rows.map(toRecord);
}

export function trainingWorkerPresence(
  worker: TrainingWorkerRecord,
  at: Date = new Date(),
): WorkerPresence {
  return workerPresence(worker.lastSeenAt, at);
}
