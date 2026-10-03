import { and, eq, notExists, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { AnnotationRef } from "../../domain/annotation/schema";
import { database } from "../infra/db/client";
import {
  annotationRuns,
  annotations,
  datasetImages,
  datasets,
  experimentObservationImages,
  experimentObservations,
  models,
} from "../infra/db/schema";

/** How many images one listing names; the total says how many remain. */
const LISTED = 100;

const activeRuns = alias(annotationRuns, "active_runs");

export interface PendingAnnotation {
  ref: AnnotationRef;
  filename: string;
  /** The progress of the run already at work on it, which an agent continues. */
  progress: { completed: number; total: number } | null;
}

/**
 * An image waits for an agent while nobody has reviewed it and no agent has
 * proposed boxes for it, provided its model says how to annotate.
 */
function awaiting(imageId: SQLWrapper, modelId: SQLWrapper) {
  return and(
    sql`${models.annotation}->>'instructions' <> ''`,
    notExists(
      sql`(select 1 from ${annotations} where ${annotations.imageId} = ${imageId} and ${annotations.modelId} = ${modelId})`,
    ),
    notExists(
      sql`(select 1 from ${annotationRuns} where ${annotationRuns.imageId} = ${imageId} and ${annotationRuns.modelId} = ${modelId} and ${annotationRuns.status} = 'succeeded')`,
    ),
  );
}

const atActiveRun = (imageId: SQLWrapper, modelId: SQLWrapper) =>
  and(
    eq(activeRuns.imageId, imageId),
    eq(activeRuns.modelId, modelId),
    eq(activeRuns.status, "running"),
  );

/**
 * The images in datasets and experiment observations that no one has read
 * yet for their model, runs already at work first. One model narrows the
 * listing to its images.
 */
export async function listPendingAnnotations(modelId?: string): Promise<{
  total: number;
  images: PendingAnnotation[];
}> {
  const db = await database();
  const progress = {
    completed: activeRuns.completed,
    total: activeRuns.total,
  };
  const [inDatasets, inExperiments] = await Promise.all([
    db
      .select({
        digest: datasetImages.imageId,
        modelId: datasets.modelId,
        filename: datasetImages.filename,
        progress,
      })
      .from(datasetImages)
      .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
      .innerJoin(models, eq(models.id, datasets.modelId))
      .leftJoin(
        activeRuns,
        atActiveRun(datasetImages.imageId, datasets.modelId),
      )
      .where(
        and(
          awaiting(datasetImages.imageId, datasets.modelId),
          modelId ? eq(datasets.modelId, modelId) : undefined,
        ),
      ),
    db
      .select({
        digest: experimentObservationImages.imageId,
        modelId: experimentObservations.modelId,
        filename: experimentObservationImages.filename,
        progress,
      })
      .from(experimentObservationImages)
      .innerJoin(
        experimentObservations,
        and(
          eq(
            experimentObservations.experimentId,
            experimentObservationImages.experimentId,
          ),
          eq(
            experimentObservations.id,
            experimentObservationImages.observationId,
          ),
        ),
      )
      .innerJoin(models, eq(models.id, experimentObservations.modelId))
      .leftJoin(
        activeRuns,
        atActiveRun(
          experimentObservationImages.imageId,
          experimentObservations.modelId,
        ),
      )
      .where(
        and(
          awaiting(
            experimentObservationImages.imageId,
            experimentObservations.modelId,
          ),
          modelId ? eq(experimentObservations.modelId, modelId) : undefined,
        ),
      ),
  ]);
  const pending = new Map<string, PendingAnnotation>();
  for (const row of [...inDatasets, ...inExperiments]) {
    const key = `${row.digest}/${row.modelId}`;
    if (!pending.has(key))
      pending.set(key, {
        ref: { digest: row.digest, modelId: row.modelId },
        filename: row.filename,
        progress: row.progress,
      });
  }
  const images = [...pending.values()].sort(
    (a, b) =>
      Number(b.progress !== null) - Number(a.progress !== null) ||
      a.ref.modelId.localeCompare(b.ref.modelId) ||
      a.filename.localeCompare(b.filename) ||
      a.ref.digest.localeCompare(b.ref.digest),
  );
  return { total: images.length, images: images.slice(0, LISTED) };
}
