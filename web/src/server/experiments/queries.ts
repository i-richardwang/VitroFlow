import {
  and,
  asc,
  desc,
  eq,
  max,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { inSnapshot, snapshot, type Executor } from "../infra/db/client";
import {
  annotations,
  experimentObservationImages,
  experimentObservations,
  experimentTreatments,
  experimentUnits,
  experiments,
  images,
  inferenceOutcomes,
  modelVersions,
  models,
} from "../infra/db/schema";
import type {
  ExperimentGrid,
  ExperimentObservationImage,
  ExperimentSummary,
  ObservationImageCell,
  UnitSeries,
} from "../../experiments/contracts";
import { unitOrder } from "../../experiments/naming";
import {
  daysBetween,
  type ImageAnalysisState,
  type ObservationImageRef,
  type UnitRef,
} from "../../experiments/schema";
import type { Tally } from "../../models/metrics";
import {
  listObservations,
  listTreatments,
  listUnits,
  readExperimentRecord,
  requireObservation,
  toExperiment,
} from "./records";
import { toModel } from "../models/public";

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
      reviewed: sql<boolean>`${annotations.imageId} is not null`,
      error: sql<string | null>`${inferenceOutcomes.document}->>'error'`,
    })
    .from(experimentObservationImages)
    .innerJoin(experimentObservations, atImageObservation())
    .innerJoin(
      modelVersions,
      eq(modelVersions.id, experimentObservations.modelVersionId),
    )
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, experimentObservationImages.imageId),
        eq(annotations.modelId, modelVersions.modelId),
      ),
    )
    .leftJoin(inferenceOutcomes, atImageOutcome());
}

/** The observation an image was taken at. */
function atImageObservation() {
  return and(
    eq(
      experimentObservations.experimentId,
      experimentObservationImages.experimentId,
    ),
    eq(experimentObservations.id, experimentObservationImages.observationId),
  );
}

/** The image's outcome under its observation's version. */
function atImageOutcome() {
  return and(
    eq(inferenceOutcomes.imageId, experimentObservationImages.imageId),
    eq(inferenceOutcomes.modelVersionId, experimentObservations.modelVersionId),
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
    unit: row.observationImage.unitId,
    observation: row.observationImage.observationId,
    digest: row.observationImage.imageId,
    filename: row.observationImage.filename,
    state,
    detectionTally:
      row.outcomeStatus === "succeeded" ? (row.detectionTally ?? {}) : null,
    annotationTally: row.reviewed ? (row.annotationTally ?? {}) : null,
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

export function readExperimentGrid(
  experimentId: string,
): Promise<ExperimentGrid | null> {
  return snapshot(async (db) => {
    const experiment = await readExperimentRecord(experimentId, db);
    if (!experiment) return null;
    const [treatments, units, observations, observationImages] =
      await Promise.all([
        listTreatments(experimentId, db),
        listUnits(experimentId, db),
        listObservations(experiment, db),
        listObservationImageCells(experimentId, db),
      ]);
    return {
      experiment,
      treatments,
      units: unitOrder(units, treatments),
      observations,
      images: observationImages,
    };
  });
}

export function readUnit(
  ref: UnitRef,
  observationId?: string,
): Promise<UnitSeries | null> {
  return snapshot((db) => readUnitSeries(ref, observationId, db));
}

async function readUnitSeries(
  ref: UnitRef,
  observationId: string | undefined,
  db: Executor,
): Promise<UnitSeries | null> {
  const experiment = await readExperimentRecord(ref.experiment, db);
  if (!experiment) return null;
  const [treatments, units, observations, cells] = await Promise.all([
    listTreatments(ref.experiment, db),
    listUnits(ref.experiment, db),
    listObservations(experiment, db),
    observationImageGridQuery(db)
      .where(
        and(
          eq(experimentObservationImages.experimentId, ref.experiment),
          eq(experimentObservationImages.unitId, ref.unit),
        ),
      )
      .then((rows) => rows.map(toCell)),
  ]);
  const ordered = unitOrder(units, treatments);
  const unit = ordered.find((item) => item.id === ref.unit);
  if (!unit) return null;
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
    unit,
    treatments,
    navigation: ordered.map(({ id, code, treatment }) => ({
      id,
      code,
      treatment,
    })),
    observations: series,
    shown,
  };
}

export function listExperiments(): Promise<ExperimentSummary[]> {
  return snapshot(listExperimentSummaries);
}

async function listExperimentSummaries(
  db: Executor,
): Promise<ExperimentSummary[]> {
  const [base, treatmentRows, observationRows, observationImageRows] =
    await Promise.all([
      db
        .select()
        .from(experiments)
        .orderBy(
          desc(experiments.createdAt),
          asc(experiments.name),
          asc(experiments.id),
        ),
      db
        .select({
          experimentId: experimentTreatments.experimentId,
          name: experimentTreatments.name,
          position: experimentTreatments.position,
        })
        .from(experimentTreatments)
        .orderBy(asc(experimentTreatments.position)),
      db
        .select({
          experimentId: experimentObservations.experimentId,
          observedOn: max(experimentObservations.observedOn),
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
        .innerJoin(experimentObservations, atImageObservation())
        .leftJoin(inferenceOutcomes, atImageOutcome())
        .groupBy(experimentObservationImages.experimentId),
    ]);
  const names = new Map<string, string[]>();
  for (const row of treatmentRows) {
    const current = names.get(row.experimentId) ?? [];
    current.push(row.name);
    names.set(row.experimentId, current);
  }
  const latest = new Map(
    observationRows.flatMap((row) =>
      row.observedOn ? [[row.experimentId, row.observedOn] as const] : [],
    ),
  );
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
  return base.map((row) => {
    const experiment = toExperiment(row);
    const observedOn = latest.get(experiment.id);
    return {
      experiment,
      treatmentNames: names.get(experiment.id) ?? [],
      latestDay:
        observedOn === undefined
          ? null
          : daysBetween(experiment.inoculatedOn, observedOn),
      counts: counts.get(experiment.id) ?? {
        pending: 0,
        failed: 0,
        analyzed: 0,
      },
    };
  });
}

function atObservationImage(experimentId: string, observationImageId: string) {
  return and(
    eq(experimentObservationImages.experimentId, experimentId),
    eq(experimentObservationImages.id, observationImageId),
  );
}

export function readExperimentObservationImage(
  ref: ObservationImageRef,
  executor?: Executor,
): Promise<ExperimentObservationImage | null> {
  return inSnapshot(executor, (db) => readObservationImage(ref, db));
}

async function readObservationImage(
  ref: ObservationImageRef,
  db: Executor,
): Promise<ExperimentObservationImage | null> {
  const [row] = await db
    .select({
      observationImage: experimentObservationImages,
      image: images,
      experiment: experiments,
      unit: experimentUnits,
      model: models,
      outcome: inferenceOutcomes.document,
      annotation: annotations.document,
    })
    .from(experimentObservationImages)
    .innerJoin(
      experiments,
      eq(experiments.id, experimentObservationImages.experimentId),
    )
    .innerJoin(experimentObservations, atImageObservation())
    .innerJoin(
      modelVersions,
      eq(modelVersions.id, experimentObservations.modelVersionId),
    )
    .innerJoin(models, eq(models.id, modelVersions.modelId))
    .innerJoin(images, eq(images.id, experimentObservationImages.imageId))
    .innerJoin(
      experimentUnits,
      and(
        eq(
          experimentUnits.experimentId,
          experimentObservationImages.experimentId,
        ),
        eq(experimentUnits.id, experimentObservationImages.unitId),
      ),
    )
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, experimentObservationImages.imageId),
        eq(annotations.modelId, modelVersions.modelId),
      ),
    )
    .leftJoin(inferenceOutcomes, atImageOutcome())
    .where(atObservationImage(ref.experiment, ref.observationImage));
  if (!row) return null;
  const experiment = toExperiment(row.experiment);
  const observation = requireObservation(
    await listObservations(experiment, db),
    row.observationImage.observationId,
  );
  return {
    ref,
    experimentName: experiment.name,
    unit: {
      id: row.unit.id,
      code: row.unit.code,
      treatment: row.unit.treatmentId,
    },
    observation,
    model: toModel(row.model),
    review: {
      ref: { digest: row.image.id, modelId: row.model.id },
      filename: row.observationImage.filename,
      width: row.image.width,
      height: row.image.height,
      detection: row.outcome && "instances" in row.outcome ? row.outcome : null,
      annotation: row.annotation,
    },
    failure: row.outcome && "error" in row.outcome ? row.outcome : null,
  };
}
