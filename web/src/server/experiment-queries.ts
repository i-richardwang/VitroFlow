import { and, asc, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import {
  experimentDishes,
  experimentPhotos,
  experimentObservations,
  experimentTreatments,
  experiments,
  images,
  inferenceOutcomes,
  labels,
  modelVersions,
} from "../db/schema";
import type {
  ExperimentDish,
  ExperimentDishSeries,
  ExperimentGrid,
  ExperimentPhoto,
  ExperimentSummary,
  PhotoCell,
} from "../experiments/contracts";
import { rosterOrder } from "../experiments/naming";
import {
  type DishRef,
  type Experiment,
  type PhotoRef,
  type PhotoState,
  type Treatment,
} from "../experiments/schema";
import type { Tally } from "../models/readings";
import type { Model, ModelVersion } from "../models/schema";
import { imageBlobKey } from "./blobs";
import {
  type DishRecord,
  listDishes,
  listObservations,
  listTreatments,
  readExperimentRecord,
  toExperiment,
} from "./experiment-records";
import { readModel, readModelVersion, toModelVersion } from "./model-registry";

function tallyOf(document: SQL | AnyColumn) {
  return sql<Tally | null>`(select jsonb_object_agg(instance.class, instance.total) from (select item->>'class' as class, count(*) as total from jsonb_array_elements(${document}->'instances') as item group by 1) as instance)`;
}

function photoGridQuery(db: Executor) {
  return db
    .select({
      photo: experimentPhotos,
      outcomeStatus: inferenceOutcomes.status,
      observed: tallyOf(inferenceOutcomes.document),
      reviewed: tallyOf(labels.document),
      reviewComplete: sql<boolean | null>`${labels.status} = 'complete'`,
      error: sql<string | null>`${inferenceOutcomes.document}->>'error'`,
    })
    .from(experimentPhotos)
    .innerJoin(experiments, eq(experiments.id, experimentPhotos.experimentId))
    .innerJoin(modelVersions, eq(modelVersions.id, experiments.modelVersionId))
    .leftJoin(
      labels,
      and(
        eq(labels.imageId, experimentPhotos.imageId),
        eq(labels.modelId, modelVersions.modelId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentPhotos.imageId),
        eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
      ),
    );
}

type PhotoGridRow = Awaited<ReturnType<typeof photoGridQuery>>[number];

function toCell(row: PhotoGridRow): PhotoCell {
  const state: PhotoState =
    row.outcomeStatus === "succeeded"
      ? "observed"
      : row.outcomeStatus === "failed"
        ? "failed"
        : "pending";
  return {
    id: row.photo.id,
    dish: row.photo.dishId,
    observation: row.photo.observationId,
    digest: row.photo.imageId,
    filename: row.photo.filename,
    state,
    observed: row.outcomeStatus === "succeeded" ? (row.observed ?? {}) : null,
    reviewed: row.reviewComplete ? (row.reviewed ?? {}) : null,
    error: row.error,
  };
}

async function listCells(
  experimentId: string,
  db: Executor,
): Promise<PhotoCell[]> {
  const rows = await photoGridQuery(db).where(
    eq(experimentPhotos.experimentId, experimentId),
  );
  return rows.map(toCell);
}

function roster(
  dishes: DishRecord[],
  treatments: Treatment[],
): ExperimentDish[] {
  return rosterOrder(dishes, treatments).map((dish, index) => ({
    ...dish,
    position: index + 1,
  }));
}

export async function readExperimentGrid(
  experimentId: string,
): Promise<ExperimentGrid | null> {
  const db = await database();
  const experiment = await readExperimentRecord(experimentId, db);
  if (!experiment) return null;
  const { model, version } = await readTask(experiment, db);
  const [treatments, dishes, observations, photos] = await Promise.all([
    listTreatments(experimentId, db),
    listDishes(experimentId, db),
    listObservations(experiment, db),
    listCells(experimentId, db),
  ]);
  return {
    experiment,
    model,
    version,
    treatments,
    dishes: roster(dishes, treatments),
    observations,
    photos,
  };
}

async function readTask(
  experiment: Experiment,
  db: Executor,
): Promise<{ model: Model; version: ModelVersion }> {
  const version = await readModelVersion(experiment.modelVersionId, db);
  if (!version) {
    throw new Error(`Unknown model version: ${experiment.modelVersionId}`);
  }
  const model = await readModel(version.modelId, db);
  if (!model) throw new Error(`Unknown model: ${version.modelId}`);
  return { model, version };
}

export async function readExperimentDish(
  ref: DishRef,
  observationId?: string,
): Promise<ExperimentDishSeries | null> {
  const db = await database();
  const experiment = await readExperimentRecord(ref.experiment, db);
  if (!experiment) return null;
  const [{ model, version }, treatments, dishes, observations, cells] =
    await Promise.all([
      readTask(experiment, db),
      listTreatments(ref.experiment, db),
      listDishes(ref.experiment, db),
      listObservations(experiment, db),
      photoGridQuery(db)
        .where(
          and(
            eq(experimentPhotos.experimentId, ref.experiment),
            eq(experimentPhotos.dishId, ref.dish),
          ),
        )
        .then((rows) => rows.map(toCell)),
    ]);
  const ordered = roster(dishes, treatments);
  const position = ordered.findIndex((dish) => dish.id === ref.dish);
  if (position < 0) return null;
  const dish = ordered[position]!;
  const byObservation = new Map(cells.map((cell) => [cell.observation, cell]));
  const series = observations.map((observation) => ({
    observation,
    photo: byObservation.get(observation.id) ?? null,
  }));
  const chosen =
    observationId === undefined
      ? [...series].reverse().find((item) => item.photo !== null)
      : series.find(
          (item) => item.observation.id === observationId && item.photo,
        );
  if (observationId !== undefined && !chosen) return null;
  const shown = chosen?.photo
    ? await readExperimentPhoto(
        { experiment: ref.experiment, photo: chosen.photo.id },
        db,
      )
    : null;
  return {
    experiment,
    model,
    version,
    dish,
    treatment:
      treatments.find((treatment) => treatment.id === dish.treatment) ?? null,
    roster: ordered.map((item) => ({ id: item.id, label: item.label })),
    observations: series,
    shown,
  };
}

export async function listExperiments(): Promise<ExperimentSummary[]> {
  const db = await database();
  const [base, treatmentRows, dishRows, observationRows, photoRows] =
    await Promise.all([
      db
        .select({ experiment: experiments, version: modelVersions })
        .from(experiments)
        .innerJoin(
          modelVersions,
          eq(modelVersions.id, experiments.modelVersionId),
        )
        .orderBy(
          desc(experiments.createdAt),
          asc(experiments.name),
          asc(experiments.id),
        ),
      db
        .select({
          experimentId: experimentTreatments.experimentId,
          total: sql<number>`count(*)`,
        })
        .from(experimentTreatments)
        .groupBy(experimentTreatments.experimentId),
      db
        .select({
          experimentId: experimentDishes.experimentId,
          total: sql<number>`count(*)`,
        })
        .from(experimentDishes)
        .groupBy(experimentDishes.experimentId),
      db
        .select({
          experimentId: experimentObservations.experimentId,
          total: sql<number>`count(*)`,
        })
        .from(experimentObservations)
        .groupBy(experimentObservations.experimentId),
      db
        .select({
          experimentId: experimentPhotos.experimentId,
          pending: sql<number>`count(*) filter (where ${inferenceOutcomes.imageId} is null)`,
          failed: sql<number>`count(*) filter (where ${inferenceOutcomes.status} = 'failed')`,
          observed: sql<number>`count(*) filter (where ${inferenceOutcomes.status} = 'succeeded')`,
        })
        .from(experimentPhotos)
        .innerJoin(
          experiments,
          eq(experiments.id, experimentPhotos.experimentId),
        )
        .leftJoin(
          inferenceOutcomes,
          and(
            eq(inferenceOutcomes.imageId, experimentPhotos.imageId),
            eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
          ),
        )
        .groupBy(experimentPhotos.experimentId),
    ]);
  const totals = (rows: { experimentId: string; total: number }[]) =>
    new Map(rows.map((row) => [row.experimentId, Number(row.total)]));
  const treatments = totals(treatmentRows);
  const dishes = totals(dishRows);
  const observations = totals(observationRows);
  const counts = new Map(
    photoRows.map((row) => [
      row.experimentId,
      {
        pending: Number(row.pending),
        failed: Number(row.failed),
        observed: Number(row.observed),
      },
    ]),
  );
  return base.map((row) => ({
    experiment: toExperiment(row.experiment),
    version: toModelVersion(row.version),
    treatments: treatments.get(row.experiment.id) ?? 0,
    dishes: dishes.get(row.experiment.id) ?? 0,
    observations: observations.get(row.experiment.id) ?? 0,
    counts: counts.get(row.experiment.id) ?? {
      pending: 0,
      failed: 0,
      observed: 0,
    },
  }));
}

function atPhoto(experimentId: string, photoId: string) {
  return and(
    eq(experimentPhotos.experimentId, experimentId),
    eq(experimentPhotos.id, photoId),
  );
}

export async function readExperimentPhoto(
  ref: PhotoRef,
  db?: Executor,
): Promise<ExperimentPhoto | null> {
  const executor = db ?? (await database());
  const [row] = await executor
    .select({
      photo: experimentPhotos,
      image: images,
      experiment: experiments,
      dishLabel: experimentDishes.label,
      modelId: modelVersions.modelId,
      observation: experimentObservations,
      outcome: inferenceOutcomes.document,
      label: labels.document,
    })
    .from(experimentPhotos)
    .innerJoin(experiments, eq(experiments.id, experimentPhotos.experimentId))
    .innerJoin(modelVersions, eq(modelVersions.id, experiments.modelVersionId))
    .innerJoin(images, eq(images.id, experimentPhotos.imageId))
    .innerJoin(
      experimentDishes,
      and(
        eq(experimentDishes.experimentId, experimentPhotos.experimentId),
        eq(experimentDishes.id, experimentPhotos.dishId),
      ),
    )
    .innerJoin(
      experimentObservations,
      and(
        eq(experimentObservations.experimentId, experimentPhotos.experimentId),
        eq(experimentObservations.id, experimentPhotos.observationId),
      ),
    )
    .leftJoin(
      labels,
      and(
        eq(labels.imageId, experimentPhotos.imageId),
        eq(labels.modelId, modelVersions.modelId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentPhotos.imageId),
        eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
      ),
    )
    .where(atPhoto(ref.experiment, ref.photo));
  if (!row) return null;
  const experiment = toExperiment(row.experiment);
  const observations = await listObservations(experiment, executor);
  const observation = observations.find(
    (item) => item.id === row.observation.id,
  );
  if (!observation) {
    throw new Error(`Observation was not read back: ${row.observation.id}`);
  }
  return {
    ref,
    experimentName: experiment.name,
    dish: { id: row.photo.dishId, label: row.dishLabel },
    observation,
    digest: row.image.id,
    filename: row.photo.filename,
    width: row.image.width,
    height: row.image.height,
    blobKey: imageBlobKey(row.image.id),
    modelVersionId: experiment.modelVersionId,
    modelId: row.modelId,
    detection: row.outcome && "instances" in row.outcome ? row.outcome : null,
    failure: row.outcome && "error" in row.outcome ? row.outcome : null,
    label: row.label,
  };
}
