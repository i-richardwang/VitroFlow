import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { database, transaction } from "../db/client";
import {
  experimentDishes,
  experimentTreatments,
  experiments,
} from "../db/schema";
import {
  DishNotFoundError,
  ExperimentNotFoundError,
  TreatmentNotFoundError,
  TreatmentRejectedError,
} from "../experiments/errors";
import {
  type DishAssignment,
  type Experiment,
  type ExperimentRef,
  type ExperimentRequest,
  type ExperimentUpdate,
  type Treatment,
  type TreatmentRef,
  type TreatmentRequest,
  type TreatmentUpdate,
} from "../experiments/schema";
import {
  atTreatment,
  listTreatments,
  lockExperiment,
  readExperimentRecord,
  toExperiment,
  toTreatment,
} from "./experiment-records";
import { readModelVersion } from "./model-registry";

export async function readExperiment(
  experimentId: string,
): Promise<Experiment | null> {
  return readExperimentRecord(experimentId, await database());
}

export async function createExperiment(
  value: ExperimentRequest,
): Promise<Experiment> {
  const { name, description, modelVersionId } = value;
  const version = await readModelVersion(modelVersionId);
  if (!version) throw new Error(`Unknown model version: ${modelVersionId}`);
  const [row] = await (
    await database()
  )
    .insert(experiments)
    .values({
      id: randomUUID(),
      name,
      description,
      modelVersionId,
      createdAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("Experiment was not created");
  return toExperiment(row);
}

export async function updateExperiment(
  value: ExperimentUpdate,
): Promise<Experiment> {
  const { experiment, name, description } = value;
  const [row] = await (
    await database()
  )
    .update(experiments)
    .set({ name, description })
    .where(eq(experiments.id, experiment))
    .returning();
  if (!row) {
    throw new ExperimentNotFoundError(`Unknown experiment: ${experiment}`);
  }
  return toExperiment(row);
}

export async function deleteExperiment(value: ExperimentRef): Promise<void> {
  const { experiment } = value;
  const [row] = await (
    await database()
  )
    .delete(experiments)
    .where(eq(experiments.id, experiment))
    .returning({ id: experiments.id });
  if (!row) {
    throw new ExperimentNotFoundError(`Unknown experiment: ${experiment}`);
  }
}

export async function addTreatment(
  value: TreatmentRequest,
): Promise<Treatment> {
  const { experiment: experimentId, name } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const existing = await listTreatments(experimentId, tx);
    if (existing.some((treatment) => treatment.name === name)) {
      throw new TreatmentRejectedError(`Treatment ${name} already exists`);
    }
    const [row] = await tx
      .insert(experimentTreatments)
      .values({
        experimentId,
        id: randomUUID(),
        name,
        position: existing.length + 1,
      })
      .returning();
    if (!row) throw new Error("Treatment was not created");
    return toTreatment(row);
  });
}

export async function renameTreatment(
  value: TreatmentUpdate,
): Promise<Treatment> {
  const { experiment: experimentId, treatment: treatmentId, name } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const taken = (await listTreatments(experimentId, tx)).find(
      (treatment) => treatment.name === name && treatment.id !== treatmentId,
    );
    if (taken) {
      throw new TreatmentRejectedError(`Treatment ${name} already exists`);
    }
    const [row] = await tx
      .update(experimentTreatments)
      .set({ name })
      .where(atTreatment(experimentId, treatmentId))
      .returning();
    if (!row) {
      throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
    }
    return toTreatment(row);
  });
}

export async function deleteTreatment(value: TreatmentRef): Promise<void> {
  const { experiment: experimentId, treatment: treatmentId } = value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await tx
      .update(experimentDishes)
      .set({ treatmentId: null })
      .where(
        and(
          eq(experimentDishes.experimentId, experimentId),
          eq(experimentDishes.treatmentId, treatmentId),
        ),
      );
    const [row] = await tx
      .delete(experimentTreatments)
      .where(atTreatment(experimentId, treatmentId))
      .returning({ position: experimentTreatments.position });
    if (!row) {
      throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
    }
    await tx
      .update(experimentTreatments)
      .set({ position: sql`${experimentTreatments.position} - 1` })
      .where(
        and(
          eq(experimentTreatments.experimentId, experimentId),
          sql`${experimentTreatments.position} > ${row.position}`,
        ),
      );
  });
}

export async function assignDish(value: DishAssignment): Promise<void> {
  const { experiment: experimentId, dish, treatment: treatmentId } = value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    if (treatmentId !== null) {
      const [treatment] = await tx
        .select({ id: experimentTreatments.id })
        .from(experimentTreatments)
        .where(atTreatment(experimentId, treatmentId));
      if (!treatment) {
        throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
      }
    }
    const [row] = await tx
      .update(experimentDishes)
      .set({ treatmentId })
      .where(
        and(
          eq(experimentDishes.experimentId, experimentId),
          eq(experimentDishes.label, dish),
        ),
      )
      .returning({ label: experimentDishes.label });
    if (!row) throw new DishNotFoundError(`Unknown dish: ${dish}`);
  });
}
