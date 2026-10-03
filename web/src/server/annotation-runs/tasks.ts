import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { AnnotationRef } from "../../domain/annotation/schema";
import { prepareProposal } from "../../domain/annotation-runs/tasks";
import { collectRegions } from "../../domain/annotation-runs/results";
import { AnnotationRunConflictError } from "../../domain/annotation-runs/errors";
import { canonicalJson } from "../../lib/json/canonical";
import { database, transaction } from "../infra/db/client";
import {
  annotationRuns,
  annotationTasks,
  annotationPreviews,
} from "../infra/db/schema";
import { readTask, taskWhere } from "./access";
import { activeRun } from "./runs";
const conflict = (message: string): never => {
  throw new AnnotationRunConflictError(message);
};
const contentDigest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const acceptance = (
  taskId: string,
  run: typeof annotationRuns.$inferSelect,
) => ({
  taskId,
  accepted: true,
  status: run.status,
  completed: run.completed,
  total: run.total,
});

/**
 * The first region of the image's run still waiting for an answer. It stays
 * the same until it is accepted, so any agent, in any conversation, continues
 * where the last one stopped.
 */
export async function nextAnnotationTask(ref: AnnotationRef) {
  const db = await database();
  const run = await activeRun(ref, db);
  if (!run)
    return conflict(
      "No AI annotation run is in progress for this image; start one with annotation_start",
    );
  const [task] = await db
    .select({ taskId: annotationTasks.taskId })
    .from(annotationTasks)
    .where(
      and(eq(annotationTasks.runId, run.id), isNull(annotationTasks.response)),
    )
    .orderBy(asc(annotationTasks.taskId))
    .limit(1);
  if (!task) return conflict("The run has no region left to annotate");
  return { taskId: task.taskId, completed: run.completed, total: run.total };
}

export async function savePreview(taskId: string, value: unknown) {
  return transaction(async (tx) => {
    const { run, task } = await readTask(taskId, tx);
    const runId = run.id;
    if (task.response || run.status !== "running")
      return conflict("Region has already been accepted");
    const { response, content } = prepareProposal(
      value,
      task.region,
      run.definition,
    );
    const proposalId = contentDigest({ runId, taskId, response });
    await tx
      .insert(annotationPreviews)
      .values({
        runId,
        taskId,
        proposalId,
        response,
      })
      .onConflictDoNothing();
    return { run, task, content, proposalId };
  });
}

export async function submitProposal(taskId: string, proposalId: string) {
  return transaction(async (tx) => {
    const { run, task } = await readTask(taskId, tx);
    const runId = run.id;
    if (task.response) {
      if (task.acceptedProposalId !== proposalId)
        return conflict("Region already accepted a different proposal");
      return acceptance(taskId, run);
    }
    const [preview] = await tx
      .select()
      .from(annotationPreviews)
      .where(
        and(
          eq(annotationPreviews.runId, runId),
          eq(annotationPreviews.taskId, taskId),
          eq(annotationPreviews.proposalId, proposalId),
        ),
      );
    if (!preview)
      return conflict("Unknown proposal for this region; preview first");
    await tx
      .update(annotationTasks)
      .set({ response: preview.response, acceptedProposalId: proposalId })
      .where(taskWhere(runId, taskId));
    const completed = run.completed + 1;
    const succeeded = completed === run.total;
    const answered = succeeded
      ? (
          await tx
            .select()
            .from(annotationTasks)
            .where(eq(annotationTasks.runId, runId))
            .orderBy(asc(annotationTasks.taskId))
        ).flatMap(({ response, ...task }) =>
          response ? [{ ...task, response }] : [],
        )
      : [];
    const [updated] = await tx
      .update(annotationRuns)
      .set({
        completed,
        status: succeeded ? "succeeded" : "running",
        result: succeeded ? collectRegions(run.definition, answered) : null,
        updatedAt: new Date(),
      })
      .where(eq(annotationRuns.id, runId))
      .returning();
    return acceptance(taskId, updated!);
  });
}
