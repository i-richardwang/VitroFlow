import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";

import { database, type Executor } from "../infra/db/client";
import { workers } from "../infra/db/schema";
import {
  canTrain,
  workerSchema,
  type Worker,
  type WorkerHeartbeat,
  type WorkerIdentity,
} from "../../workers/schema";
import { WORKER_FORGET_SECONDS, workerPresence } from "../../workers/presence";

/** Thrown when a session is not the one the roster holds for its worker. */
export class WorkerSessionConflictError extends Error {}

function toWorker(row: typeof workers.$inferSelect): Worker {
  return workerSchema.parse({
    workerId: row.id,
    sessionId: row.sessionId,
    startedAt: row.startedAt.toISOString(),
    runtimes: row.runtimes,
    memoryBytes: row.memoryBytes,
    lastSeenAt: row.lastSeenAt.toISOString(),
  });
}

function forgetBefore(at: Date): Date {
  return new Date(at.getTime() - WORKER_FORGET_SECONDS * 1000);
}

/** Workers silent for longer than the forget window leave the roster. */
async function forgetSilentWorkers(at: Date, db: Executor): Promise<void> {
  await db.delete(workers).where(lt(workers.lastSeenAt, forgetBefore(at)));
}

/**
 * A worker heartbeats while polling for work and while it holds a lease;
 * presence is derived from the heartbeat age. A worker id names one process
 * at a time: a newer session replaces an older one, and an older session
 * that heartbeats afterwards is refused.
 */
export async function recordWorkerHeartbeat(
  heartbeat: WorkerHeartbeat,
  at: Date = new Date(),
): Promise<Worker> {
  const worker = workerSchema.parse({
    ...heartbeat,
    lastSeenAt: at.toISOString(),
  });
  const row = {
    sessionId: worker.sessionId,
    startedAt: new Date(worker.startedAt),
    runtimes: worker.runtimes,
    memoryBytes: worker.memoryBytes,
    lastSeenAt: at,
  };
  const db = await database();
  const [stored] = await db
    .insert(workers)
    .values({ id: worker.workerId, ...row })
    .onConflictDoUpdate({
      target: workers.id,
      set: row,
      setWhere: or(
        eq(workers.sessionId, worker.sessionId),
        lt(workers.startedAt, new Date(worker.startedAt)),
      ),
    })
    .returning();
  if (!stored) {
    throw new WorkerSessionConflictError(
      `Worker ${worker.workerId} has a newer active session`,
    );
  }
  await forgetSilentWorkers(at, db);
  return toWorker(stored);
}

function sessionRow(identity: WorkerIdentity, db: Executor) {
  return db
    .select()
    .from(workers)
    .where(
      and(
        eq(workers.id, identity.workerId),
        eq(workers.sessionId, identity.sessionId),
      ),
    );
}

function sessionOf(
  identity: WorkerIdentity,
  row: typeof workers.$inferSelect | undefined,
): Worker {
  if (!row) {
    throw new WorkerSessionConflictError(
      `Worker ${identity.workerId} must heartbeat as ${identity.sessionId} before owning work`,
    );
  }
  return toWorker(row);
}

/**
 * The worker as its current session, or a conflict when the roster holds no
 * such session: a process must heartbeat before it can own work.
 */
export async function currentWorkerSession(
  identity: WorkerIdentity,
  db?: Executor,
): Promise<Worker> {
  const [row] = await sessionRow(identity, db ?? (await database()));
  return sessionOf(identity, row);
}

/** The current session with its row locked, so one worker claims one job at a time. */
export async function lockWorkerSession(
  identity: WorkerIdentity,
  tx: Executor,
): Promise<Worker> {
  const [row] = await sessionRow(identity, tx).for("update");
  return sessionOf(identity, row);
}

/**
 * A session is a fencing token: a predicate that holds only while the roster
 * still names it, so a write from a replaced process never lands.
 */
export function sessionIsCurrent(owner: WorkerIdentity) {
  return sql`exists (
    select 1 from ${workers}
    where ${workers.id} = ${owner.workerId}
      and ${workers.sessionId} = ${owner.sessionId}
  )`;
}

/** Workers heard from within the forget window, newest first. */
export async function listWorkers(at: Date = new Date()): Promise<Worker[]> {
  const db = await database();
  const rows = await db
    .select()
    .from(workers)
    .where(gte(workers.lastSeenAt, forgetBefore(at)))
    .orderBy(desc(workers.lastSeenAt));
  return rows.map(toWorker);
}

/** Workers online now that could take a training run. */
export async function listOnlineTrainers(
  at: Date = new Date(),
): Promise<Worker[]> {
  const online = await listWorkers(at);
  return online.filter(
    (worker) =>
      canTrain(worker) && workerPresence(worker.lastSeenAt, at) === "online",
  );
}
