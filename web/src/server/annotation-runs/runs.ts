import { regions } from "../../domain/annotation-runs/tasks";
import { and, eq, inArray, lte } from "drizzle-orm";
import {
  annotationSchema,
  type AnnotationRef,
} from "../../domain/annotation/schema";
import {
  annotationDefinitionSchema,
  type AnnotationRun,
  type AnnotationRuntimeName,
  type StartAnnotationRun,
} from "../../domain/annotation-runs/schema";
import { assertInstanceClasses } from "../../domain/models/classes";
import { workerPresence } from "../../domain/workers/presence";
import { canonicalJson } from "../../lib/json/canonical";
import { transaction, type Executor } from "../infra/db/client";
import { annotationRuns, annotationTasks, images } from "../infra/db/schema";
import { lockImage } from "../images/public";
import { readModel } from "../models/public";
import { listWorkers } from "../workers/public";

import {
  AnnotationRunConflictError,
  AnnotationRunNotFoundError,
} from "../../domain/annotation-runs/errors";
import { LEASE_EXPIRED, effectiveStatus } from "./readings";

function present(row: typeof annotationRuns.$inferSelect): AnnotationRun {
  return {
    id: row.id,
    ref: { digest: row.imageId, modelId: row.modelId },
    requestedBy: row.requestedBy,
    executor: row.executor,
    runtime: row.runtime,
    ...effectiveStatus(row),
    progress: { completed: row.completed, total: row.total },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    result: row.result,
  };
}

/** The agents some online Worker can run right now, in a stable order. */
export async function availableAnnotationRuntimes(): Promise<
  AnnotationRuntimeName[]
> {
  const names = new Set<AnnotationRuntimeName>();
  for (const worker of await listWorkers()) {
    if (workerPresence(worker.lastSeenAt) !== "online") continue;
    for (const runtime of worker.annotationRuntimes) names.add(runtime.runtime);
  }
  return [...names].sort();
}

/** Expired work fails explicitly; a new paid attempt requires a new request. */
export async function expireAnnotationRuns(at: Date, db: Executor) {
  await db
    .update(annotationRuns)
    .set({
      status: "failed",
      updatedAt: at,
      error: LEASE_EXPIRED,
    })
    .where(
      and(
        eq(annotationRuns.status, "running"),
        lte(annotationRuns.leaseExpiresAt, at),
      ),
    );
}

export async function createAnnotationRun(
  request: StartAnnotationRun,
  requestedBy: string,
): Promise<AnnotationRun> {
  const available =
    request.executor.kind === "worker"
      ? await availableAnnotationRuntimes()
      : [];
  const run = await transaction((tx) =>
    admitRun(request, requestedBy, available, tx),
  );
  if (!run)
    throw new AnnotationRunConflictError(
      "This image already has an active AI annotation run",
    );
  return run;
}

/** Under the image lock, either admit this request or leave its active run alone. */
async function admitRun(
  request: StartAnnotationRun,
  requestedBy: string,
  available: AnnotationRuntimeName[],
  tx: Executor,
): Promise<AnnotationRun | null> {
  await lockImage(request.ref.digest, tx);
  const [existing] = await tx
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, request.id));
  if (existing) {
    if (
      existing.requestedBy !== requestedBy ||
      canonicalJson(existing.request) !== canonicalJson(request)
    )
      throw new AnnotationRunConflictError(
        "Request id already has different inputs",
      );
    return present(existing);
  }
  const now = new Date();
  await expireAnnotationRuns(now, tx);
  const [active] = await tx
    .select()
    .from(annotationRuns)
    .where(
      and(
        eq(annotationRuns.imageId, request.ref.digest),
        eq(annotationRuns.modelId, request.ref.modelId),
        inArray(annotationRuns.status, ["queued", "running"]),
      ),
    );
  if (active) return null;
  const [image] = await tx
    .select()
    .from(images)
    .where(eq(images.id, request.ref.digest));
  const model = await readModel(request.ref.modelId, tx);
  if (!image || !model)
    throw new AnnotationRunNotFoundError("Image or labeling model not found");
  if (request.input) {
    annotationSchema.parse({
      schemaVersion: 1,
      image: { digest: image.id, width: image.width, height: image.height },
      instances: request.input,
    });
    assertInstanceClasses(model.classes, request.input, "AI annotation input");
  }
  if (
    request.executor.kind === "worker" &&
    !available.includes(request.executor.runtime)
  )
    throw new AnnotationRunConflictError(
      "No online Worker provides the selected agent",
    );
  const { instructions, ...region } = model.annotation;
  if (!instructions)
    throw new AnnotationRunConflictError(
      "The model has no annotation instructions; add them on the Models page",
    );
  const definition = annotationDefinitionSchema.parse({
    image: { digest: image.id, width: image.width, height: image.height },
    input: request.input,
    config: { classes: model.classes, rules: instructions, ...region },
  });
  const tasks = regions(definition);
  if (tasks.length > 4096)
    throw new AnnotationRunConflictError(
      "Annotation requires too many regions; increase the model's core size",
    );
  const [row] = await tx
    .insert(annotationRuns)
    .values({
      id: request.id,
      imageId: image.id,
      modelId: model.id,
      requestedBy,
      request,
      definition,
      executor: request.executor,
      status: request.executor.kind === "interactive" ? "running" : "queued",
      total: tasks.length,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  for (let i = 0; i < tasks.length; i += 1000) {
    await tx.insert(annotationTasks).values(
      tasks.slice(i, i + 1000).map((region) => ({
        runId: request.id,
        taskId: `${request.id}/${region.id}`,
        region,
      })),
    );
  }
  return present(row!);
}

/**
 * One run per image, from the image alone, skipping images an agent is
 * already working on. The count is how many were started.
 */
export async function createAnnotationRuns(
  refs: AnnotationRef[],
  runtime: AnnotationRuntimeName,
  requestedBy: string,
): Promise<number> {
  if (!refs.length) return 0;
  const available = await availableAnnotationRuntimes();
  let started = 0;
  for (const ref of refs) {
    const run = await transaction((tx) =>
      admitRun(
        {
          id: crypto.randomUUID(),
          ref,
          executor: { kind: "worker", runtime },
          input: null,
        },
        requestedBy,
        available,
        tx,
      ),
    );
    if (run) started++;
  }
  return started;
}

export async function cancelAnnotationRun(id: string): Promise<void> {
  await transaction(async (tx) => {
    const now = new Date();
    await expireAnnotationRuns(now, tx);
    await tx
      .update(annotationRuns)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(annotationRuns.id, id),
          inArray(annotationRuns.status, ["queued", "running"]),
        ),
      );
  });
}
