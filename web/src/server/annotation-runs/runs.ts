import { regions } from "../../domain/annotation-runs/tasks";
import { sourceInstances } from "../../domain/annotation/review";
import { and, eq } from "drizzle-orm";
import {
  annotationSchema,
  type AnnotationRef,
  type BoundingBox,
  type ReviewSource,
} from "../../domain/annotation/schema";
import {
  annotationDefinitionSchema,
  type AnnotationRun,
  type StartAnnotationRun,
} from "../../domain/annotation-runs/schema";
import { assertInstanceClasses } from "../../domain/models/classes";
import { transaction, type Executor } from "../infra/db/client";
import { annotationRuns, annotationTasks, images } from "../infra/db/schema";
import { lockImage, resolveDishCoverage } from "../images/public";
import { readModel } from "../models/public";

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

/**
 * Starts the image's run. It stays open until every region is accepted or it
 * is cancelled, and any connected agent continues it.
 */
export async function createAnnotationRun(
  request: StartAnnotationRun,
): Promise<AnnotationRun> {
  return transaction(async (tx) => {
    await lockImage(request.ref.digest, tx);
    const active = await activeRun(request.ref, tx);
    if (active)
      throw new AnnotationRunConflictError(
        `This image already has an AI annotation run in progress (${active.completed}/${active.total} regions); continue it with annotation_next`,
      );
    return admitRun(request, tx);
  });
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

/** Freezes the request's definition and plans its regions, under the image lock. */
async function admitRun(
  request: StartAnnotationRun,
  tx: Executor,
): Promise<AnnotationRun> {
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
      definition,
      status: "running",
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
  return present(row!);
}

/** The image's run in progress for the model. */
export async function activeRun(ref: AnnotationRef, db: Executor) {
  const [row] = await db
    .select()
    .from(annotationRuns)
    .where(
      and(
        eq(annotationRuns.imageId, ref.digest),
        eq(annotationRuns.modelId, ref.modelId),
        eq(annotationRuns.status, "running"),
      ),
    );
  return row ?? null;
}

/**
 * Gives up the image's run in progress and its accepted regions, so another
 * can start with different input or scope.
 */
export async function cancelAnnotationRun(ref: AnnotationRef): Promise<void> {
  await transaction(async (tx) => {
    await lockImage(ref.digest, tx);
    const active = await activeRun(ref, tx);
    if (!active)
      throw new AnnotationRunConflictError(
        "No AI annotation run is in progress for this image",
      );
    await tx
      .update(annotationRuns)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(annotationRuns.id, active.id));
  });
}
