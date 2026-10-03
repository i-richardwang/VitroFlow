import { regions } from "../../domain/annotation-runs/tasks";
import { sourceInstances } from "../../domain/annotation/review";
import { and, eq, inArray } from "drizzle-orm";
import {
  annotationSchema,
  type AnnotationRef,
  type BoundingBox,
  type ReviewSource,
} from "../../domain/annotation/schema";
import {
  annotationDefinitionSchema,
  type AnnotationExecutor,
  type AnnotationRun,
  type StartAnnotationRun,
  type AnnotationBatchResult,
} from "../../domain/annotation-runs/schema";
import { assertInstanceClasses } from "../../domain/models/classes";
import { workerPresence } from "../../domain/workers/presence";
import { database, transaction, type Executor } from "../infra/db/client";
import { annotationRuns, annotationTasks, images } from "../infra/db/schema";
import { lockImage, resolveDishCoverage } from "../images/public";
import { readModel } from "../models/public";
import { listWorkers } from "../workers/public";

import {
  AnnotationRunConflictError,
  AnnotationRunNotFoundError,
} from "../../domain/annotation-runs/errors";
import { readReadings } from "../readings/public";

function present(row: typeof annotationRuns.$inferSelect): AnnotationRun {
  return {
    id: row.id,
    status: row.status,
    progress: { completed: row.completed, total: row.total },
  };
}

/** Whether some online Worker runs an annotation agent right now. */
export async function annotationWorkerOnline(): Promise<boolean> {
  return (await listWorkers()).some(
    (worker) =>
      worker.annotationRuntime !== null &&
      workerPresence(worker.lastSeenAt) === "online",
  );
}

async function requireAnnotationWorker() {
  if (!(await annotationWorkerOnline()))
    throw new AnnotationRunConflictError("No AI annotation agent is online");
}

/**
 * Starts one run. A Worker run waits in the queue for any Worker with an
 * agent; an interactive run stays open to the person who started it until
 * every region is accepted or it is cancelled.
 */
export async function createAnnotationRun(
  request: StartAnnotationRun,
  executor: AnnotationExecutor,
  requestedBy: string,
): Promise<AnnotationRun> {
  if (executor === "worker") await requireAnnotationWorker();
  const admitted = await transaction((tx) =>
    admitRun(request, executor, requestedBy, tx),
  );
  if ("active" in admitted) {
    const { completed, total } = admitted.active.progress;
    throw new AnnotationRunConflictError(
      `This image already has an AI annotation run in progress (${completed}/${total} regions)`,
    );
  }
  return admitted.run;
}

/** Freeze a reading's boxes and, for an AI proposal, its unresolved questions. */
async function readingInput(
  ref: AnnotationRef,
  source: ReviewSource,
  tx: Executor,
) {
  const readings = await readReadings(ref, tx);
  const instances = readings && sourceInstances(readings, source);
  if (!instances)
    throw new AnnotationRunConflictError(
      `The image has no ${source} to begin from`,
    );
  return {
    input: instances,
    ...(source === "proposal" && readings?.proposal
      ? {
          inputNotes: {
            issues: readings.proposal.issues,
            uncertainIds: readings.proposal.uncertainIds,
          },
        }
      : {}),
  };
}

/** Under the image lock, either admit this request or leave its active run alone. */
async function admitRun(
  request: StartAnnotationRun,
  executor: AnnotationExecutor,
  requestedBy: string,
  tx: Executor,
): Promise<{ run: AnnotationRun } | { active: AnnotationRun }> {
  await lockImage(request.ref.digest, tx);
  const active = await activeRun(request.ref, tx);
  if (active) return { active: present(active) };
  const [image] = await tx
    .select()
    .from(images)
    .where(eq(images.id, request.ref.digest));
  const model = await readModel(request.ref.modelId, tx);
  if (!image || !model)
    throw new AnnotationRunNotFoundError("Image or labeling model not found");
  const frame = { digest: image.id, width: image.width, height: image.height };
  const initial =
    typeof request.input === "string"
      ? await readingInput(request.ref, request.input, tx)
      : { input: request.input };
  const { input } = initial;
  if (input) {
    annotationSchema.parse({
      schemaVersion: 1,
      image: frame,
      instances: input,
    });
    assertInstanceClasses(model.classes, input, "AI annotation input");
  }
  if (request.scope) {
    if (!input)
      throw new AnnotationRunConflictError(
        "Redrawing part of the image needs the boxes to keep; pass input",
      );
    const inside = (b: BoundingBox) =>
      b.x >= 0 &&
      b.y >= 0 &&
      b.x + b.width <= image.width &&
      b.y + b.height <= image.height;
    if (!request.scope.every(inside))
      throw new AnnotationRunConflictError("Scope exceeds image bounds");
  }
  const { instructions, ...region } = model.annotation;
  if (!instructions)
    throw new AnnotationRunConflictError(
      "The model has no annotation instructions; add them on the Models page",
    );
  const dish = region.area === "dish" ? resolveDishCoverage(image) : null;
  const definition = annotationDefinitionSchema.parse({
    image: frame,
    coverage: dish?.coverage ?? null,
    ...initial,
    scope: request.scope,
    config: { classes: model.classes, rules: instructions, ...region },
  });
  const tasks = regions(definition);
  if (!tasks.length)
    throw new AnnotationRunConflictError("The scope touches no region");
  if (tasks.length > 4096)
    throw new AnnotationRunConflictError(
      "Annotation requires too many regions; increase the model's core size",
    );
  const id = crypto.randomUUID();
  const now = new Date();
  const [row] = await tx
    .insert(annotationRuns)
    .values({
      id,
      imageId: image.id,
      modelId: model.id,
      requestedBy,
      definition,
      executor,
      status: executor === "interactive" ? "running" : "queued",
      total: tasks.length,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  for (let i = 0; i < tasks.length; i += 1000) {
    await tx.insert(annotationTasks).values(
      tasks.slice(i, i + 1000).map((region) => ({
        runId: id,
        taskId: `${id}/${region.id}`,
        region,
      })),
    );
  }
  if (dish?.fallback)
    process.stderr.write(
      `${JSON.stringify({
        event: "annotation-run.full-image-coverage",
        runId: id,
        imageId: image.id,
        reason: dish.fallback,
      })}\n`,
    );
  return { run: present(row!) };
}

/**
 * One Worker run per image, from the image alone, skipping images an agent
 * is already working on. Each image has an independent admission result.
 */
export async function createAnnotationRuns(
  refs: AnnotationRef[],
  requestedBy: string,
): Promise<AnnotationBatchResult> {
  const result: AnnotationBatchResult = { started: 0, skipped: 0, failed: [] };
  if (!refs.length) return result;
  await requireAnnotationWorker();
  for (const ref of refs) {
    try {
      const admitted = await transaction((tx) =>
        admitRun({ ref, input: null, scope: null }, "worker", requestedBy, tx),
      );
      if ("run" in admitted) result.started++;
      else result.skipped++;
    } catch (error) {
      const expected =
        error instanceof AnnotationRunConflictError ||
        error instanceof AnnotationRunNotFoundError;
      if (!expected)
        console.error("Annotation run admission failed", ref, error);
      result.failed.push({
        ref,
        message: expected ? error.message : "Could not create annotation run",
      });
    }
  }
  return result;
}

/** The image's run still in progress for the model, whoever drives it. */
export async function activeRun(ref: AnnotationRef, db: Executor) {
  const [row] = await db
    .select()
    .from(annotationRuns)
    .where(
      and(
        eq(annotationRuns.imageId, ref.digest),
        eq(annotationRuns.modelId, ref.modelId),
        inArray(annotationRuns.status, ["queued", "running"]),
      ),
    );
  return row ?? null;
}

/** Cancels the image's run in progress, whoever drives it. */
export async function cancelAnnotationRun(ref: AnnotationRef): Promise<void> {
  await (
    await database()
  )
    .update(annotationRuns)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(annotationRuns.imageId, ref.digest),
        eq(annotationRuns.modelId, ref.modelId),
        inArray(annotationRuns.status, ["queued", "running"]),
      ),
    );
}
