import { and, asc, eq } from "drizzle-orm";

import type { Executor } from "../db/client";
import {
  experimentCultureEvents,
  experimentObservationImages,
  experimentObservations,
  experimentTreatments,
  experimentUnits,
  experiments,
  modelVersions,
  models,
} from "../db/schema";
import type { Unit } from "../experiments/contracts";
import {
  ExperimentNotFoundError,
  ObservationNotFoundError,
} from "../experiments/errors";
import {
  cultureEventSchema,
  daysBetween,
  experimentObservationSchema,
  experimentSchema,
  treatmentSchema,
  type CultureEvent,
  type Experiment,
  type ExperimentObservation,
  type Treatment,
} from "../experiments/schema";
import type { Model } from "../models/schema";
import { toModel } from "./model-registry";

export function toExperiment(row: typeof experiments.$inferSelect): Experiment {
  return experimentSchema.parse({
    id: row.id,
    name: row.name,
    plantMaterial: row.plantMaterial,
    explantType: row.explantType,
    baseMedium: row.baseMedium,
    notes: row.notes,
    inoculatedOn: row.inoculatedOn,
    createdAt: row.createdAt.toISOString(),
  });
}

export function toTreatment(
  row: typeof experimentTreatments.$inferSelect,
): Treatment {
  return treatmentSchema.parse({
    id: row.id,
    name: row.name,
    factor: row.factor ?? null,
    note: row.note,
    position: row.position,
  });
}

export function toUnit(
  row: typeof experimentUnits.$inferSelect,
  events: CultureEvent[] = [],
): Unit {
  return {
    id: row.id,
    code: row.code,
    treatment: row.treatmentId,
    events,
  };
}

function toCultureEvent(
  row: typeof experimentCultureEvents.$inferSelect,
): CultureEvent {
  return cultureEventSchema.parse({
    id: row.id,
    type: row.type,
    observation: row.observationId,
    recordedAt: row.recordedAt.toISOString(),
  });
}

function toObservation(
  row: typeof experimentObservations.$inferSelect,
  model: Model,
  experiment: Experiment,
  ordinal: number,
  hasRecords: boolean,
): ExperimentObservation {
  const metric = model.metrics.find((item) => item.id === row.metric);
  if (!metric) {
    throw new Error(`Model ${model.id} declares no metric ${row.metric}`);
  }
  return experimentObservationSchema.parse({
    id: row.id,
    ordinal,
    observedOn: row.observedOn,
    day: daysBetween(experiment.inoculatedOn, row.observedOn),
    note: row.note,
    modelVersionId: row.modelVersionId,
    metric,
    hasRecords,
  });
}

export async function readExperimentRecord(
  experimentId: string,
  db: Executor,
): Promise<Experiment | null> {
  const [row] = await db
    .select()
    .from(experiments)
    .where(eq(experiments.id, experimentId));
  return row ? toExperiment(row) : null;
}

export async function lockExperiment(
  experimentId: string,
  tx: Executor,
): Promise<Experiment> {
  const [locked] = await tx
    .select()
    .from(experiments)
    .where(eq(experiments.id, experimentId))
    .for("update");
  if (!locked) {
    throw new ExperimentNotFoundError(`Unknown experiment: ${experimentId}`);
  }
  return toExperiment(locked);
}

export async function listTreatments(
  experimentId: string,
  db: Executor,
): Promise<Treatment[]> {
  const rows = await db
    .select()
    .from(experimentTreatments)
    .where(eq(experimentTreatments.experimentId, experimentId))
    .orderBy(asc(experimentTreatments.position));
  return rows.map(toTreatment);
}

export function atTreatment(experimentId: string, treatmentId: string) {
  return and(
    eq(experimentTreatments.experimentId, experimentId),
    eq(experimentTreatments.id, treatmentId),
  );
}

export function atUnit(experimentId: string, unitId: string) {
  return and(
    eq(experimentUnits.experimentId, experimentId),
    eq(experimentUnits.id, unitId),
  );
}

export function atObservation(experimentId: string, observationId: string) {
  return and(
    eq(experimentObservations.experimentId, experimentId),
    eq(experimentObservations.id, observationId),
  );
}

export async function listUnits(
  experimentId: string,
  db: Executor,
): Promise<Unit[]> {
  const [rows, eventRows] = await Promise.all([
    db
      .select()
      .from(experimentUnits)
      .where(eq(experimentUnits.experimentId, experimentId))
      .orderBy(asc(experimentUnits.code)),
    db
      .select()
      .from(experimentCultureEvents)
      .where(eq(experimentCultureEvents.experimentId, experimentId))
      .orderBy(
        asc(experimentCultureEvents.recordedAt),
        asc(experimentCultureEvents.id),
      ),
  ]);
  const byUnit = new Map<string, CultureEvent[]>();
  for (const row of eventRows) {
    const events = byUnit.get(row.unitId) ?? [];
    events.push(toCultureEvent(row));
    byUnit.set(row.unitId, events);
  }
  return rows.map((row) => toUnit(row, byUnit.get(row.id) ?? []));
}

export async function listObservations(
  experiment: Experiment,
  db: Executor,
): Promise<ExperimentObservation[]> {
  const [rows, observationImageRefs, eventRefs] = await Promise.all([
    db
      .select({ observation: experimentObservations, model: models })
      .from(experimentObservations)
      .innerJoin(
        modelVersions,
        eq(modelVersions.id, experimentObservations.modelVersionId),
      )
      .innerJoin(models, eq(models.id, modelVersions.modelId))
      .where(eq(experimentObservations.experimentId, experiment.id))
      .orderBy(asc(experimentObservations.observedOn)),
    db
      .select({ observation: experimentObservationImages.observationId })
      .from(experimentObservationImages)
      .where(eq(experimentObservationImages.experimentId, experiment.id)),
    db
      .select({ observation: experimentCultureEvents.observationId })
      .from(experimentCultureEvents)
      .where(eq(experimentCultureEvents.experimentId, experiment.id)),
  ]);
  const recorded = new Set([
    ...observationImageRefs.map((row) => row.observation),
    ...eventRefs.map((row) => row.observation),
  ]);
  return rows.map(({ observation, model }, index) =>
    toObservation(
      observation,
      toModel(model),
      experiment,
      index + 1,
      recorded.has(observation.id),
    ),
  );
}

export function requireObservation(
  observations: ExperimentObservation[],
  observationId: string,
): ExperimentObservation {
  const observation = observations.find((item) => item.id === observationId);
  if (!observation) {
    throw new ObservationNotFoundError(`Unknown observation: ${observationId}`);
  }
  return observation;
}
