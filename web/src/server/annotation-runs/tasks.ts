import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { AnnotationPrincipal } from "../../domain/annotation-runs/access";
import { validateProposal } from "../../domain/annotation-runs/tasks";
import { collectRegions } from "../../domain/annotation-runs/results";
import { AnnotationRunConflictError } from "../../domain/annotation-runs/errors";
import { canonicalJson } from "../../lib/json/canonical";
import { transaction } from "../infra/db/client";
import {
  annotationRuns,
  annotationTasks,
  annotationPreviews,
} from "../infra/db/schema";
import { lockRun, authorizeRun, readTask, taskWhere } from "./access";
const conflict = (message: string): never => {
  throw new AnnotationRunConflictError(message);
};
const contentDigest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

/** Interactive clients resume the current unfinished region rather than silently skipping it. */
export async function nextAnnotationTask(
  principal: AnnotationPrincipal,
  runId: string,
) {
  if (principal.kind !== "user")
    return conflict("Only user sessions may select tasks");
  return transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    await authorizeRun(tx, run, principal);
    const tasks = await tx
      .select()
      .from(annotationTasks)
      .where(eq(annotationTasks.runId, runId))
      .orderBy(asc(annotationTasks.taskId));
    const task = tasks.find((t) => t.response === null);
    if (!task)
      return {
        runId,
        status: run.status,
        completed: run.completed,
        total: run.total,
        taskId: null,
      };
    if (!task.attemptId)
      await tx
        .update(annotationTasks)
        .set({ attemptId: crypto.randomUUID() })
        .where(taskWhere(runId, task.taskId));
    return {
      runId,
      status: run.status,
      completed: run.completed,
      total: run.total,
      taskId: task.taskId,
    };
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
    const response = validateProposal(value, task.region, run.definition);
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
    return { run, task, response, proposalId };
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
      validateProposal(preview.response, task.region, run.definition);
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
      runId,
      taskId,
      accepted: true,
      status: run.status,
      completed: run.completed,
      total: run.total,
    };
  });
}
