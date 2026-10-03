import { and, eq } from "drizzle-orm";
import { AnnotationRunConflictError } from "../../domain/annotation-runs/errors";
import { database, type Executor } from "../infra/db/client";
import { annotationRuns, annotationTasks } from "../infra/db/schema";

const conflict = (message: string): never => {
  throw new AnnotationRunConflictError(message);
};
export const taskWhere = (runId: string, taskId: string) =>
  and(eq(annotationTasks.runId, runId), eq(annotationTasks.taskId, taskId));

export async function lockRun(tx: Executor, runId: string) {
  const [row] = await tx
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, runId))
    .for("update");
  return row ?? conflict("Annotation run not found");
}

/**
 * A region by its opaque task identifier, with its run. A finished run still
 * answers, so a repeated submission learns it was accepted; a cancelled one
 * does not.
 */
export async function readTask(taskId: string, tx?: Executor) {
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
  if (run.status === "cancelled")
    return conflict("Annotation run is not active");
  const [task] = await db
    .select()
    .from(annotationTasks)
    .where(taskWhere(runId, taskId));
  if (!task) return conflict("Annotation task not found");
  return { run, task };
}
