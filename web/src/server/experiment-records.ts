import { and, asc, eq } from "drizzle-orm";

import type { Executor } from "../db/client";
import {
  experimentDishEvents,
  experimentDishes,
  experimentPhotos,
  experimentObservations,
  experimentTreatments,
  experiments,
} from "../db/schema";
import type { ExperimentDish } from "../experiments/contracts";
import { ExperimentNotFoundError } from "../experiments/errors";
import {
  daysBetween,
  dishEventSchema,
  experimentObservationSchema,
  experimentSchema,
  treatmentSchema,
  type Experiment,
  type DishEvent,
  type ExperimentObservation,
  type Treatment,
} from "../experiments/schema";

export function toExperiment(row: typeof experiments.$inferSelect): Experiment {
  return experimentSchema.parse({
    id: row.id,
    name: row.name,
    material: row.material,
    explant: row.explant,
    medium: row.medium,
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
    factors: row.factors,
    note: row.note,
    position: row.position,
  });
}

export type DishRecord = Omit<ExperimentDish, "position">;

export function toDish(
  row: typeof experimentDishes.$inferSelect,
  events: DishEvent[] = [],
): DishRecord {
  return {
    id: row.id,
    label: row.label,
    treatment: row.treatmentId,
    initialExplantCount: row.initialExplantCount,
    events,
  };
}

function toDishEvent(row: typeof experimentDishEvents.$inferSelect): DishEvent {
  return dishEventSchema.parse({
    id: row.id,
    type: row.type,
    observation: row.observationId,
    excludeFromObservation: row.excludeFromObservation,
    removeAfterObservation: row.removeAfterObservation,
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

export function atDish(experimentId: string, dishId: string) {
  return and(
    eq(experimentDishes.experimentId, experimentId),
    eq(experimentDishes.id, dishId),
  );
}

export function atObservation(experimentId: string, observationId: string) {
  return and(
    eq(experimentObservations.experimentId, experimentId),
    eq(experimentObservations.id, observationId),
  );
}

export async function listDishes(
  experimentId: string,
  db: Executor,
): Promise<DishRecord[]> {
  const [rows, eventRows] = await Promise.all([
    db
      .select()
      .from(experimentDishes)
      .where(eq(experimentDishes.experimentId, experimentId))
      .orderBy(asc(experimentDishes.label)),
    db
      .select()
      .from(experimentDishEvents)
      .where(eq(experimentDishEvents.experimentId, experimentId))
      .orderBy(
        asc(experimentDishEvents.recordedAt),
        asc(experimentDishEvents.id),
      ),
  ]);
  const byDish = new Map<string, DishEvent[]>();
  for (const row of eventRows) {
    const events = byDish.get(row.dishId) ?? [];
    events.push(toDishEvent(row));
    byDish.set(row.dishId, events);
  }
  return rows.map((row) => toDish(row, byDish.get(row.id) ?? []));
}

export async function listObservations(
  experiment: Experiment,
  db: Executor,
): Promise<ExperimentObservation[]> {
  const [rows, photoRefs, eventRefs] = await Promise.all([
    db
      .select()
      .from(experimentObservations)
      .where(eq(experimentObservations.experimentId, experiment.id))
      .orderBy(asc(experimentObservations.observedOn)),
    db
      .select({ observation: experimentPhotos.observationId })
      .from(experimentPhotos)
      .where(eq(experimentPhotos.experimentId, experiment.id)),
    db
      .select({ observation: experimentDishEvents.observationId })
      .from(experimentDishEvents)
      .where(eq(experimentDishEvents.experimentId, experiment.id)),
  ]);
  const recorded = new Set([
    ...photoRefs.map((row) => row.observation),
    ...eventRefs.map((row) => row.observation),
  ]);
  return rows.map((row, index) =>
    toObservation(row, experiment, index + 1, recorded.has(row.id)),
  );
}
