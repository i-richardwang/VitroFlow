import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { WorkerIdentity } from "../../domain/workers/schema";
import { AnnotationRunConflictError } from "../../domain/annotation-runs/errors";
import { database, transaction, type Executor } from "../infra/db/client";
import { annotationRuns, annotationTasks } from "../infra/db/schema";
import { lockWorkerSession, currentWorkerSession } from "../workers/public";
import { lockRun, requireWorkerLease, taskWhere, type RunRow } from "./access";

const LEASE_MS = 5 * 60 * 1000;
function conflict(message: string): never {
  throw new AnnotationRunConflictError(message);
}
const job = (run: RunRow) => ({ id: run.id });

/**
 * A Worker that stopped renewing its lease lets go of its run: the run
 * returns to the queue with every accepted region, and the regions still
 * open lose their attempts, fencing the credentials issued for them.
 */
async function releaseLapsedClaims(at: Date, db: Executor) {
  const released = await db
    .update(annotationRuns)
    .set({
      status: "queued",
      workerId: null,
      sessionId: null,
      leaseExpiresAt: null,
      updatedAt: at,
    })
    .where(
      and(
        eq(annotationRuns.status, "running"),
        lte(annotationRuns.leaseExpiresAt, at),
      ),
    )
    .returning({ id: annotationRuns.id });
  if (!released.length) return;
  await db
    .update(annotationTasks)
    .set({ attemptId: null })
    .where(
      and(
        inArray(
          annotationTasks.runId,
          released.map((run) => run.id),
        ),
        isNull(annotationTasks.response),
      ),
    );
}

/** The oldest queued run goes to a Worker that runs an agent. */
export async function claimAnnotationRun(
  owner: WorkerIdentity,
  at = new Date(),
) {
  return transaction(async (tx) => {
    const worker = await lockWorkerSession(owner, tx);
    await releaseLapsedClaims(at, tx);
    if (!worker.annotationRuntime) return null;
    const [owned] = await tx
      .select()
      .from(annotationRuns)
      .where(
        and(
          eq(annotationRuns.workerId, owner.workerId),
          eq(annotationRuns.sessionId, owner.sessionId),
          eq(annotationRuns.status, "running"),
        ),
      );
    // A replayed HTTP claim returns the same job, never a second paid job.
    if (owned) return job(owned);
    const candidates = await tx
      .select()
      .from(annotationRuns)
      .where(eq(annotationRuns.status, "queued"))
      .orderBy(asc(annotationRuns.createdAt))
      .for("update", { skipLocked: true })
      .limit(1);
    const row = candidates[0];
    if (!row) return null;
    await tx
      .update(annotationRuns)
      .set({
        status: "running",
        workerId: owner.workerId,
        sessionId: owner.sessionId,
        leaseExpiresAt: new Date(at.getTime() + LEASE_MS),
        updatedAt: at,
      })
      .where(eq(annotationRuns.id, row.id));
    return job(row);
  });
}

/** A trusted supervisor issues a narrowly scoped credential, never its Worker secret. */
export async function assignWorkerTask(
  runId: string,
  owner: WorkerIdentity,
  taskId: string,
  attemptId: string,
) {
  return transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run.status !== "running") conflict("Annotation run is not running");
    await requireWorkerLease(tx, run, owner);
    const [task] = await tx
      .select()
      .from(annotationTasks)
      .where(taskWhere(runId, taskId));
    if (!task) return conflict("Unknown annotation region");
    if (task.response) return { accepted: true as const, taskId };
    // An explicit new attempt fences every tool and proposal from the old one.
    await tx
      .update(annotationTasks)
      .set({ attemptId })
      .where(taskWhere(runId, taskId));
    return {
      accepted: false as const,
      taskId,
      principal: {
        kind: "task" as const,
        runId,
        taskId,
        attemptId,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      },
    };
  });
}
export async function workerAnnotationStatus(
  runId: string,
  owner: WorkerIdentity,
) {
  const db = await database();
  const [run] = await db
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, runId));
  if (
    !run ||
    run.workerId !== owner.workerId ||
    run.sessionId !== owner.sessionId
  )
    return conflict("Wrong annotation owner");
  if (run.status === "running") await requireWorkerLease(db, run, owner);
  const tasks = await db
    .select()
    .from(annotationTasks)
    .where(eq(annotationTasks.runId, runId))
    .orderBy(asc(annotationTasks.taskId));
  return {
    status: run.status,
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      accepted: t.response !== null,
    })),
    completed: run.completed,
    total: run.total,
  };
}

/** The owning supervisor may observe a completed run without extending its lease. */
export async function renewAnnotationRun(
  id: string,
  owner: WorkerIdentity,
  at = new Date(),
) {
  await transaction(async (tx) => {
    const run = await lockRun(tx, id);
    await currentWorkerSession(owner, tx);
    if (run.workerId !== owner.workerId || run.sessionId !== owner.sessionId)
      return conflict("Wrong annotation owner");
    if (run.status === "succeeded") return;
    if (
      run.status !== "running" ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt <= at
    )
      return conflict("AI annotation lease is no longer active");
    await tx
      .update(annotationRuns)
      .set({ leaseExpiresAt: new Date(at.getTime() + LEASE_MS), updatedAt: at })
      .where(eq(annotationRuns.id, id));
  });
}
export async function failAnnotationRun(
  id: string,
  owner: WorkerIdentity,
  error: string,
) {
  await transaction(async (tx) => {
    const run = await lockRun(tx, id);
    await requireWorkerLease(tx, run, owner);
    if (run.status !== "running")
      return conflict("Annotation run is not running");
    await tx
      .update(annotationRuns)
      .set({ status: "failed", error, updatedAt: new Date() })
      .where(eq(annotationRuns.id, id));
  });
}
