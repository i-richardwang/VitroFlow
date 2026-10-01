import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { AnnotationPrincipal } from "../../domain/annotation-runs/access";
import type { AnnotationRef } from "../../domain/annotation/schema";
import { prepareProposal } from "../../domain/annotation-runs/tasks";
import { collectRegions } from "../../domain/annotation-runs/results";
import { AnnotationRunConflictError } from "../../domain/annotation-runs/errors";
import { canonicalJson } from "../../lib/json/canonical";
import { transaction, type Executor } from "../infra/db/client";
import {
  annotationRuns,
  annotationTasks,
  annotationPreviews,
} from "../infra/db/schema";
import { lockRun, readTask, taskWhere } from "./access";
import { activeRun } from "./runs";
const conflict = (message: string): never => {
  throw new AnnotationRunConflictError(message);
};
const contentDigest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

/**
 * The run a person's connected agent drives on an image: the one in progress
 * for the model, provided that person started it from a connected agent.
 */
async function ownActiveRun(
  principal: AnnotationPrincipal,
  ref: AnnotationRef,
  tx: Executor,
) {
  if (principal.kind !== "user")
    return conflict("Only user sessions may choose a run");
  const active = await activeRun(ref, tx);
  const run = active && (await lockRun(tx, active.id));
  if (!run || (run.status !== "queued" && run.status !== "running"))
    return conflict(
      "No AI annotation run is in progress for this image; start one with annotation_start",
    );
  if (run.executor !== "interactive")
    return conflict("A Worker agent is annotating this image");
  if (run.requestedBy !== principal.userId)
    return conflict("Another person is annotating this image");
  return run;
}

/**
 * The first region of the image's run still waiting for an answer. It stays
 * the same until it is accepted, so any agent the person connects, in any
 * conversation, continues where the last one stopped.
 */
export async function nextAnnotationTask(
  principal: AnnotationPrincipal,
  ref: AnnotationRef,
) {
  return transaction(async (tx) => {
    const run = await ownActiveRun(principal, ref, tx);
    const [task] = await tx
      .select()
      .from(annotationTasks)
      .where(
        and(
          eq(annotationTasks.runId, run.id),
          isNull(annotationTasks.response),
        ),
      )
      .orderBy(asc(annotationTasks.taskId))
      .limit(1);
    if (!task) return conflict("The run has no region left to annotate");
    if (!task.attemptId)
      await tx
        .update(annotationTasks)
        .set({ attemptId: crypto.randomUUID() })
        .where(taskWhere(run.id, task.taskId));
    return {
      taskId: task.taskId,
      completed: run.completed,
      total: run.total,
    };
  });
}

/** A person's agent may give up its own run, to start again differently. */
export async function cancelOwnAnnotationRun(
  principal: AnnotationPrincipal,
  ref: AnnotationRef,
) {
  await transaction(async (tx) => {
    const run = await ownActiveRun(principal, ref, tx);
    await tx
      .update(annotationRuns)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(annotationRuns.id, run.id));
  });
}

export async function savePreview(
  principal: AnnotationPrincipal,
  taskId: string,
  value: unknown,
) {
  return transaction(async (tx) => {
    const { run, task } = await readTask(principal, taskId, tx);
    const runId = run.id;
    if (task.response || run.status !== "running")
      return conflict("Region has already been accepted");
    const { response, content } = prepareProposal(
      value,
      task.region,
      run.definition,
    );
    const proposalId = contentDigest({
      runId,
      taskId,
      attemptId: task.attemptId,
      response,
    });
    await tx
      .insert(annotationPreviews)
      .values({
        runId,
        taskId,
        attemptId: task.attemptId,
        proposalId,
        response,
      })
      .onConflictDoNothing();
    return { run, task, content, proposalId };
  });
}

export async function submitProposal(
  principal: AnnotationPrincipal,
  taskId: string,
  proposalId: string,
) {
  return transaction(async (tx) => {
    const { run, task } = await readTask(principal, taskId, tx);
    const runId = run.id;
    if (task.response) {
      if (task.acceptedProposalId !== proposalId)
        return conflict("Region already accepted a different proposal");
    } else {
      const [preview] = await tx
        .select()
        .from(annotationPreviews)
        .where(
          and(
            eq(annotationPreviews.runId, runId),
            eq(annotationPreviews.taskId, taskId),
            eq(annotationPreviews.attemptId, task.attemptId),
            eq(annotationPreviews.proposalId, proposalId),
          ),
        );
      if (!preview)
        return conflict("Unknown proposal for this attempt; preview first");
      await tx
        .update(annotationTasks)
        .set({ response: preview.response, acceptedProposalId: proposalId })
        .where(taskWhere(runId, taskId));
      const tasks = await tx
        .select()
        .from(annotationTasks)
        .where(eq(annotationTasks.runId, runId))
        .orderBy(asc(annotationTasks.taskId));
      run.completed = tasks.filter((t) => t.response !== null).length;
      const complete = run.completed === run.total;
      run.status = complete ? "succeeded" : "running";
      await tx
        .update(annotationRuns)
        .set({
          completed: run.completed,
          status: run.status,
          result: complete ? collectRegions(run.definition, tasks) : null,
          updatedAt: new Date(),
        })
        .where(eq(annotationRuns.id, runId));
    }
    return {
      taskId,
      accepted: true,
      status: run.status,
      completed: run.completed,
      total: run.total,
    };
  });
}
