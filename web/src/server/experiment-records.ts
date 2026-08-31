import { and, asc, eq } from "drizzle-orm";

import type { Executor } from "../db/client";
import {
  experimentDishes,
  experimentRounds,
  experimentTreatments,
  experiments,
} from "../db/schema";
import type { ExperimentDish } from "../experiments/contracts";
import { ExperimentNotFoundError } from "../experiments/errors";
import {
  experimentRoundSchema,
  experimentSchema,
  treatmentSchema,
  type Experiment,
  type ExperimentRound,
  type Treatment,
} from "../experiments/schema";

export function toExperiment(row: typeof experiments.$inferSelect): Experiment {
  return experimentSchema.parse({
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    description: row.description,
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
    position: row.position,
  });
}

export function toRound(
  row: typeof experimentRounds.$inferSelect,
): ExperimentRound {
  return experimentRoundSchema.parse({
    id: row.id,
    label: row.label,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
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
): Promise<void> {
  const [locked] = await tx
    .select({ id: experiments.id })
    .from(experiments)
    .where(eq(experiments.id, experimentId))
    .for("update");
  if (!locked) {
    throw new ExperimentNotFoundError(`Unknown experiment: ${experimentId}`);
  }
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

export async function listDishes(
  experimentId: string,
  db: Executor,
): Promise<ExperimentDish[]> {
  return db
    .select({
      label: experimentDishes.label,
      position: experimentDishes.position,
      treatment: experimentDishes.treatmentId,
    })
    .from(experimentDishes)
    .where(eq(experimentDishes.experimentId, experimentId))
    .orderBy(asc(experimentDishes.position));
}

export async function listRounds(
  experimentId: string,
  db: Executor,
): Promise<ExperimentRound[]> {
  const rows = await db
    .select()
    .from(experimentRounds)
    .where(eq(experimentRounds.experimentId, experimentId))
    .orderBy(asc(experimentRounds.capturedAt), asc(experimentRounds.id));
  return rows.map(toRound);
}
