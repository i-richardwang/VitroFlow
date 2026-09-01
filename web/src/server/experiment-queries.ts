import { and, asc, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import {
  experimentObservationUnits,
  experimentObservationImages,
  experimentObservations,
  experimentTreatments,
  experiments,
  images,
  inferenceOutcomes,
  annotations,
  modelVersions,
} from "../db/schema";
import type {
  ObservationUnit,
  ObservationUnitSeries,
  ExperimentGrid,
  ExperimentObservationImage,
  ExperimentSummary,
  ObservationImageCell,
} from "../experiments/contracts";
import { observationUnitOrder } from "../experiments/naming";
import {
  type ObservationUnitRef,
  type Experiment,
  type ObservationImageRef,
  type ImageAnalysisState,
  type Treatment,
} from "../experiments/schema";
import type { Tally } from "../models/metrics";
import type { Model, ModelVersion } from "../models/schema";
import { imageBlobKey } from "./blobs";
import {
  type ObservationUnitRecord,
  listObservationUnits,
  listObservations,
  listTreatments,
  readExperimentRecord,
  toExperiment,
} from "./experiment-records";
import { readModel, readModelVersion, toModelVersion } from "./model-registry";

function tallyOf(document: SQL | AnyColumn) {
  return sql<Tally | null>`(select jsonb_object_agg(instance.class, instance.total) from (select item->>'class' as class, count(*) as total from jsonb_array_elements(${document}->'instances') as item group by 1) as instance)`;
}

function observationImageGridQuery(db: Executor) {
  return db
    .select({
      observationImage: experimentObservationImages,
      outcomeStatus: inferenceOutcomes.status,
      detectionTally: tallyOf(inferenceOutcomes.document),
      annotationTally: tallyOf(annotations.document),
      reviewComplete: sql<boolean | null>`${annotations.status} = 'complete'`,
      error: sql<string | null>`${inferenceOutcomes.document}->>'error'`,
    })
    .from(experimentObservationImages)
    .innerJoin(
      experiments,
      eq(experiments.id, experimentObservationImages.experimentId),
    )
    .innerJoin(modelVersions, eq(modelVersions.id, experiments.modelVersionId))
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, experimentObservationImages.imageId),
        eq(annotations.modelId, modelVersions.modelId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentObservationImages.imageId),
        eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
      ),
    );
}

type ObservationImageGridRow = Awaited<
  ReturnType<typeof observationImageGridQuery>
>[number];

function toCell(row: ObservationImageGridRow): ObservationImageCell {
  const state: ImageAnalysisState =
    row.outcomeStatus === "succeeded"
      ? "analyzed"
      : row.outcomeStatus === "failed"
        ? "failed"
        : "pending";
  return {
    id: row.observationImage.id,
    observationUnit: row.observationImage.observationUnitId,
    observation: row.observationImage.observationId,
    digest: row.observationImage.imageId,
    filename: row.observationImage.filename,
    state,
    detectionTally:
      row.outcomeStatus === "succeeded" ? (row.detectionTally ?? {}) : null,
    annotationTally: row.reviewComplete ? (row.annotationTally ?? {}) : null,
    error: row.error,
  };
}

async function listObservationImageCells(
  experimentId: string,
  db: Executor,
): Promise<ObservationImageCell[]> {
  const rows = await observationImageGridQuery(db).where(
    eq(experimentObservationImages.experimentId, experimentId),
  );
  return rows.map(toCell);
}

function orderedObservationUnits(
  observationUnits: ObservationUnitRecord[],
  treatments: Treatment[],
): ObservationUnit[] {
  return observationUnitOrder(observationUnits, treatments).map(
    (observationUnit, index) => ({
      ...observationUnit,
      position: index + 1,
    }),
  );
}

export async function readExperimentGrid(
  experimentId: string,
): Promise<ExperimentGrid | null> {
  const db = await database();
  const experiment = await readExperimentRecord(experimentId, db);
  if (!experiment) return null;
  const { model, version } = await readTask(experiment, db);
  const [treatments, observationUnits, observations, observationImages] =
    await Promise.all([
      listTreatments(experimentId, db),
      listObservationUnits(experimentId, db),
      listObservations(experiment, db),
      listObservationImageCells(experimentId, db),
    ]);
  return {
    experiment,
    model,
    version,
    treatments,
    observationUnits: orderedObservationUnits(observationUnits, treatments),
    observations,
    images: observationImages,
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

export async function readObservationUnit(
  ref: ObservationUnitRef,
  observationId?: string,
): Promise<ObservationUnitSeries | null> {
  const db = await database();
  const experiment = await readExperimentRecord(ref.experiment, db);
  if (!experiment) return null;
  const [
    { model, version },
    treatments,
    observationUnits,
    observations,
    cells,
  ] = await Promise.all([
    readTask(experiment, db),
    listTreatments(ref.experiment, db),
    listObservationUnits(ref.experiment, db),
    listObservations(experiment, db),
    observationImageGridQuery(db)
      .where(
        and(
          eq(experimentObservationImages.experimentId, ref.experiment),
          eq(
            experimentObservationImages.observationUnitId,
            ref.observationUnit,
          ),
        ),
      )
      .then((rows) => rows.map(toCell)),
  ]);
  const ordered = orderedObservationUnits(observationUnits, treatments);
  const position = ordered.findIndex(
    (observationUnit) => observationUnit.id === ref.observationUnit,
  );
  if (position < 0) return null;
  const observationUnit = ordered[position]!;
  const byObservation = new Map(cells.map((cell) => [cell.observation, cell]));
  const series = observations.map((observation) => ({
    observation,
    image: byObservation.get(observation.id) ?? null,
  }));
  const chosen =
    observationId === undefined
      ? [...series].reverse().find((item) => item.image !== null)
      : series.find(
          (item) => item.observation.id === observationId && item.image,
        );
  if (observationId !== undefined && !chosen) return null;
  const shown = chosen?.image
    ? await readExperimentObservationImage(
        {
          experiment: ref.experiment,
          observationImage: chosen.image.id,
        },
        db,
      )
    : null;
  return {
    experiment,
    model,
    version,
    observationUnit,
    treatment:
      treatments.find(
        (treatment) => treatment.id === observationUnit.treatment,
      ) ?? null,
    navigation: ordered.map((item) => ({ id: item.id, code: item.code })),
    observations: series,
    shown,
  };
}

export async function listExperiments(): Promise<ExperimentSummary[]> {
  const db = await database();
  const [
    base,
    treatmentRows,
    observationUnitRows,
    observationRows,
    observationImageRows,
  ] = await Promise.all([
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
        experimentId: experimentObservationUnits.experimentId,
        total: sql<number>`count(*)`,
      })
      .from(experimentObservationUnits)
      .groupBy(experimentObservationUnits.experimentId),
    db
      .select({
        experimentId: experimentObservations.experimentId,
        total: sql<number>`count(*)`,
      })
      .from(experimentObservations)
      .groupBy(experimentObservations.experimentId),
    db
      .select({
        experimentId: experimentObservationImages.experimentId,
        pending: sql<number>`count(*) filter (where ${inferenceOutcomes.imageId} is null)`,
        failed: sql<number>`count(*) filter (where ${inferenceOutcomes.status} = 'failed')`,
        analyzed: sql<number>`count(*) filter (where ${inferenceOutcomes.status} = 'succeeded')`,
      })
      .from(experimentObservationImages)
      .innerJoin(
        experiments,
        eq(experiments.id, experimentObservationImages.experimentId),
      )
      .leftJoin(
        inferenceOutcomes,
        and(
          eq(inferenceOutcomes.imageId, experimentObservationImages.imageId),
          eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
        ),
      )
      .groupBy(experimentObservationImages.experimentId),
  ]);
  const totals = (rows: { experimentId: string; total: number }[]) =>
    new Map(rows.map((row) => [row.experimentId, Number(row.total)]));
  const treatments = totals(treatmentRows);
  const observationUnits = totals(observationUnitRows);
  const observations = totals(observationRows);
  const counts = new Map(
    observationImageRows.map((row) => [
      row.experimentId,
      {
        pending: Number(row.pending),
        failed: Number(row.failed),
        analyzed: Number(row.analyzed),
      },
    ]),
  );
  return base.map((row) => ({
    experiment: toExperiment(row.experiment),
    version: toModelVersion(row.version),
    treatments: treatments.get(row.experiment.id) ?? 0,
    observationUnits: observationUnits.get(row.experiment.id) ?? 0,
    observations: observations.get(row.experiment.id) ?? 0,
    counts: counts.get(row.experiment.id) ?? {
      pending: 0,
      failed: 0,
      analyzed: 0,
    },
  }));
}

function atObservationImage(experimentId: string, observationImageId: string) {
  return and(
    eq(experimentObservationImages.experimentId, experimentId),
    eq(experimentObservationImages.id, observationImageId),
  );
}

export async function readExperimentObservationImage(
  ref: ObservationImageRef,
  db?: Executor,
): Promise<ExperimentObservationImage | null> {
  const executor = db ?? (await database());
  const [row] = await executor
    .select({
      observationImage: experimentObservationImages,
      image: images,
      experiment: experiments,
      observationUnitCode: experimentObservationUnits.code,
      modelId: modelVersions.modelId,
      observation: experimentObservations,
      outcome: inferenceOutcomes.document,
      annotation: annotations.document,
    })
    .from(experimentObservationImages)
    .innerJoin(
      experiments,
      eq(experiments.id, experimentObservationImages.experimentId),
    )
    .innerJoin(modelVersions, eq(modelVersions.id, experiments.modelVersionId))
    .innerJoin(images, eq(images.id, experimentObservationImages.imageId))
    .innerJoin(
      experimentObservationUnits,
      and(
        eq(
          experimentObservationUnits.experimentId,
          experimentObservationImages.experimentId,
        ),
        eq(
          experimentObservationUnits.id,
          experimentObservationImages.observationUnitId,
        ),
      ),
    )
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
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, experimentObservationImages.imageId),
        eq(annotations.modelId, modelVersions.modelId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentObservationImages.imageId),
        eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
      ),
    )
    .where(atObservationImage(ref.experiment, ref.observationImage));
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
    observationUnit: {
      id: row.observationImage.observationUnitId,
      code: row.observationUnitCode,
    },
    observation,
    digest: row.image.id,
    filename: row.observationImage.filename,
    width: row.image.width,
    height: row.image.height,
    blobKey: imageBlobKey(row.image.id),
    modelVersionId: experiment.modelVersionId,
    modelId: row.modelId,
    detection: row.outcome && "instances" in row.outcome ? row.outcome : null,
    failure: row.outcome && "error" in row.outcome ? row.outcome : null,
    annotation: row.annotation,
  };
}
