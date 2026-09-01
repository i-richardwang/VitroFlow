import { and, asc, eq } from "drizzle-orm";

import type { Executor } from "../db/client";
import {
  experimentCultureEvents,
  experimentObservationUnits,
  experimentObservationImages,
  experimentObservations,
  experimentTreatments,
  experiments,
} from "../db/schema";
import type { ObservationUnit } from "../experiments/contracts";
import {
  ExperimentNotFoundError,
  ObservationNotFoundError,
} from "../experiments/errors";
import {
  daysBetween,
  cultureEventSchema,
  experimentObservationSchema,
  experimentSchema,
  treatmentSchema,
  type Experiment,
  type CultureEvent,
  type ExperimentObservation,
  type Treatment,
} from "../experiments/schema";

export function toExperiment(row: typeof experiments.$inferSelect): Experiment {
  return experimentSchema.parse({
    id: row.id,
    name: row.name,
    plantMaterial: row.plantMaterial,
    explantType: row.explantType,
    baseMedium: row.baseMedium,
    notes: row.notes,
    inoculatedOn: row.inoculatedOn,
    modelVersionId: row.modelVersionId,
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

export type ObservationUnitRecord = Omit<ObservationUnit, "position">;

export function toObservationUnit(
  row: typeof experimentObservationUnits.$inferSelect,
  events: CultureEvent[] = [],
): ObservationUnitRecord {
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
    excludeFromObservation: row.excludeFromObservation,
    note: row.note,
    recordedAt: row.recordedAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  });
}

export function toObservation(
  row: typeof experimentObservations.$inferSelect,
  experiment: Experiment,
  ordinal: number,
  hasRecords: boolean,
): ExperimentObservation {
  return experimentObservationSchema.parse({
    id: row.id,
    ordinal,
    observedOn: row.observedOn,
    day: daysBetween(experiment.inoculatedOn, row.observedOn),
    note: row.note,
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

export function atObservationUnit(
  experimentId: string,
  observationUnitId: string,
) {
  return and(
    eq(experimentObservationUnits.experimentId, experimentId),
    eq(experimentObservationUnits.id, observationUnitId),
  );
}

export function atObservation(experimentId: string, observationId: string) {
  return and(
    eq(experimentObservations.experimentId, experimentId),
    eq(experimentObservations.id, observationId),
  );
}

export async function listObservationUnits(
  experimentId: string,
  db: Executor,
): Promise<ObservationUnitRecord[]> {
  const [rows, eventRows] = await Promise.all([
    db
      .select()
      .from(experimentObservationUnits)
      .where(eq(experimentObservationUnits.experimentId, experimentId))
      .orderBy(asc(experimentObservationUnits.code)),
    db
      .select()
      .from(experimentCultureEvents)
      .where(eq(experimentCultureEvents.experimentId, experimentId))
      .orderBy(
        asc(experimentCultureEvents.recordedAt),
        asc(experimentCultureEvents.id),
      ),
  ]);
  const byObservationUnit = new Map<string, CultureEvent[]>();
  for (const row of eventRows) {
    const events = byObservationUnit.get(row.observationUnitId) ?? [];
    events.push(toCultureEvent(row));
    byObservationUnit.set(row.observationUnitId, events);
  }
  return rows.map((row) =>
    toObservationUnit(row, byObservationUnit.get(row.id) ?? []),
  );
}

export async function listObservations(
  experiment: Experiment,
  db: Executor,
): Promise<ExperimentObservation[]> {
  const [rows, observationImageRefs, eventRefs] = await Promise.all([
    db
      .select()
      .from(experimentObservations)
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
  return rows.map((row, index) =>
    toObservation(row, experiment, index + 1, recorded.has(row.id)),
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
