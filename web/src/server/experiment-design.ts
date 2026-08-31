import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

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
import { inferTreatments } from "../experiments/naming";
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
  listDishes,
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
  const { name, material, explant, medium, notes, modelVersionId } = value;
  const version = await readModelVersion(modelVersionId);
  if (!version) throw new Error(`Unknown model version: ${modelVersionId}`);
  const [row] = await (
    await database()
  )
    .insert(experiments)
    .values({
      id: randomUUID(),
      name,
      material,
      explant,
      medium,
      notes,
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
  const { experiment, name, material, explant, medium, notes } = value;
  const [row] = await (
    await database()
  )
    .update(experiments)
    .set({ name, material, explant, medium, notes })
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
  const { experiment: experimentId, name, description } = value;
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
        description,
        position: existing.length + 1,
      })
      .returning();
    if (!row) throw new Error("Treatment was not created");
    return toTreatment(row);
  });
}

export async function updateTreatment(
  value: TreatmentUpdate,
): Promise<Treatment> {
  const {
    experiment: experimentId,
    treatment: treatmentId,
    name,
    description,
  } = value;
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
      .set({ name, description })
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

/**
 * Groups the unassigned dishes by the treatments their names spell out,
 * creating any treatment the roster names for the first time. Dishes whose
 * names do not group, and dishes already assigned, are left alone.
 */
export async function assignDishesByName(
  value: ExperimentRef,
): Promise<number> {
  const { experiment: experimentId } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const dishes = await listDishes(experimentId, tx);
    const plan = inferTreatments(dishes.map((dish) => dish.label));
    if (plan.length === 0) {
      throw new TreatmentRejectedError("Dish names spell out no treatments");
    }
    const unassigned = new Set(
      dishes
        .filter((dish) => dish.treatment === null)
        .map((dish) => dish.label),
    );
    const pending = plan
      .map((group) => ({
        ...group,
        dishes: group.dishes.filter((dish) => unassigned.has(dish)),
      }))
      .filter((group) => group.dishes.length > 0);
    const existing = await listTreatments(experimentId, tx);
    const byName = new Map(
      existing.map((treatment) => [treatment.name, treatment.id]),
    );
    let position = existing.length;
    for (const { name } of pending) {
      if (byName.has(name)) continue;
      position += 1;
      const [row] = await tx
        .insert(experimentTreatments)
        .values({
          experimentId,
          id: randomUUID(),
          name,
          description: "",
          position,
        })
        .returning();
      if (!row) throw new Error("Treatment was not created");
      byName.set(name, row.id);
    }
    let assigned = 0;
    for (const { name, dishes: labels } of pending) {
      const treatmentId = byName.get(name);
      if (treatmentId === undefined) {
        throw new Error(`Treatment ${name} was not created`);
      }
      await tx
        .update(experimentDishes)
        .set({ treatmentId })
        .where(
          and(
            eq(experimentDishes.experimentId, experimentId),
            inArray(experimentDishes.label, labels),
          ),
        );
      assigned += labels.length;
    }
    return assigned;
  });
}

export async function assignDishes(value: DishAssignment): Promise<void> {
  const { experiment: experimentId, dishes, treatment: treatmentId } = value;
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
    const rows = await tx
      .update(experimentDishes)
      .set({ treatmentId })
      .where(
        and(
          eq(experimentDishes.experimentId, experimentId),
          inArray(experimentDishes.label, dishes),
        ),
      )
      .returning({ label: experimentDishes.label });
    const updated = new Set(rows.map((row) => row.label));
    const missing = dishes.filter((dish) => !updated.has(dish));
    if (missing.length > 0) {
      throw new DishNotFoundError(`Unknown dishes: ${missing.join(", ")}`);
    }
  });
}
