import { and, eq } from "drizzle-orm";
import type { AnnotationPrincipal } from "../../domain/annotation-runs/access";
import type { WorkerIdentity } from "../../domain/workers/schema";
import { AnnotationRunConflictError } from "../../domain/annotation-runs/errors";
import { database, type Executor } from "../infra/db/client";
import { annotationRuns, annotationTasks } from "../infra/db/schema";
import { lockWorkerSession, sessionIsCurrent } from "../workers/public";

export type RunRow = typeof annotationRuns.$inferSelect;
const conflict = (message: string): never => {
  throw new AnnotationRunConflictError(message);
};
export const taskWhere = (runId: string, taskId: string) =>
  and(eq(annotationTasks.runId, runId), eq(annotationTasks.taskId, taskId));

export async function lockRun(tx: Executor, runId: string): Promise<RunRow> {
  // Follow claim's Worker -> run lock order, fencing replacement sessions
  // throughout acceptance without introducing a lock-order inversion.
  const [before] = await tx
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, runId));
  if (before?.status === "running" && before.workerId && before.sessionId) {
    await lockWorkerSession(
      { workerId: before.workerId, sessionId: before.sessionId },
      tx,
    );
  }
  const [row] = await tx
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, runId))
    .for("update");
  return row ?? conflict("Annotation run not found");
}
export async function requireWorkerLease(
  tx: Executor,
  row: RunRow,
  owner: WorkerIdentity,
) {
  if (
    row.workerId !== owner.workerId ||
    row.sessionId !== owner.sessionId ||
    !row.leaseExpiresAt ||
    row.leaseExpiresAt.getTime() <= Date.now()
  )
    conflict("AI annotation lease is no longer active");
  const [current] = await tx
    .select({ id: annotationRuns.id })
    .from(annotationRuns)
    .where(and(eq(annotationRuns.id, row.id), sessionIsCurrent(owner)));
  if (!current) conflict("Worker session has been replaced");
}
export async function authorizeRun(
  tx: Executor,
  row: RunRow,
  principal: AnnotationPrincipal,
) {
  if (row.status !== "running" && row.status !== "succeeded")
    conflict("Annotation run is not active");
  if (principal.kind === "user") {
    if (
      row.requestedBy !== principal.userId ||
      row.executor.kind !== "interactive"
    )
      conflict("Annotation run is not owned by this user");
  } else {
    if (principal.runId !== row.id || principal.expiresAt <= Date.now())
      conflict("Task credential expired or belongs to another run");
    // Completion receipts remain replayable until token expiry. No further writes are accepted.
    if (row.status === "running")
      await requireWorkerLease(tx, row, {
        workerId: row.workerId!,
        sessionId: row.sessionId!,
      });
  }
}
/** Core operations resolve an opaque task identifier inside the owning module. */
export async function readTask(
  principal: AnnotationPrincipal,
  taskId: string,
  tx?: Executor,
) {
  const parts = taskId.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return conflict("Invalid task identifier");
  const runId = parts[0];
  const db = tx ?? (await database());
  const run = tx
    ? await lockRun(tx, runId)
    : (
        await db
          .select()
          .from(annotationRuns)
          .where(eq(annotationRuns.id, runId))
      )[0];
  if (!run) return conflict("Annotation run not found");
  await authorizeRun(db, run, principal);
  const [task] = await db
    .select()
    .from(annotationTasks)
    .where(taskWhere(runId, taskId));
  if (!task?.attemptId) return conflict("Region has not been assigned");
  if (
    principal.kind === "task" &&
    (principal.taskId !== taskId || principal.attemptId !== task.attemptId)
  )
    return conflict("Credential is bound to a different region or attempt");
  return { run, task: { ...task, attemptId: task.attemptId } };
}
export async function validateTaskPrincipal(
  principal: Extract<AnnotationPrincipal, { kind: "task" }>,
) {
  await readTask(principal, principal.taskId);
}
