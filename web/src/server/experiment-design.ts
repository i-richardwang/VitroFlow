import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  experimentDishes,
  experimentObservations,
  experimentTreatments,
  experiments,
} from "../db/schema";
import {
  DishNotFoundError,
  DishRejectedError,
  ExperimentDesignLockedError,
  ExperimentHasRecordsError,
  ExperimentNotFoundError,
  TreatmentNotFoundError,
  TreatmentRejectedError,
} from "../experiments/errors";
import { dishLabelKey, replicateLabels } from "../experiments/naming";
import {
  type DishAssignment,
  type DishLayout,
  type DishRef,
  type DishUpdate,
  type Experiment,
  type ExperimentRef,
  type ExperimentRequest,
  type ExperimentUpdate,
  type Treatment,
  type TreatmentRef,
  type TreatmentRequest,
  type TreatmentReplicates,
  type TreatmentUpdate,
} from "../experiments/schema";
import {
  atDish,
  type DishRecord,
  atTreatment,
  listDishes,
  listTreatments,
  lockExperiment,
  readExperimentRecord,
  toDish,
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
  const { modelVersionId } = value;
  const version = await readModelVersion(modelVersionId);
  if (!version) throw new Error(`Unknown model version: ${modelVersionId}`);
  const [row] = await (
    await database()
  )
    .insert(experiments)
    .values({ ...value, id: randomUUID(), createdAt: new Date() })
    .returning();
  if (!row) throw new Error("Experiment was not created");
  return toExperiment(row);
}

export async function updateExperiment(
  value: ExperimentUpdate,
): Promise<Experiment> {
  const { experiment: experimentId, ...page } = value;
  return transaction(async (tx) => {
    const current = await lockExperiment(experimentId, tx);
    if (await designLocked(experimentId, tx)) {
      const protocolChanged =
        page.material !== current.material ||
        page.explant !== current.explant ||
        page.medium !== current.medium ||
        page.inoculatedOn !== current.inoculatedOn;
      if (protocolChanged) {
        throw new ExperimentDesignLockedError(
          "The protocol is fixed after the first observation",
        );
      }
    }
    const [row] = await tx
      .update(experiments)
      .set(page)
      .where(eq(experiments.id, experimentId))
      .returning();
    if (!row) {
      throw new ExperimentNotFoundError(`Unknown experiment: ${experimentId}`);
    }
    return toExperiment(row);
  });
}

export async function deleteExperiment(value: ExperimentRef): Promise<void> {
  const { experiment } = value;
  await transaction(async (tx) => {
    await lockExperiment(experiment, tx);
    if (await designLocked(experiment, tx)) {
      throw new ExperimentHasRecordsError(
        "An experiment with observations is a scientific record and cannot be deleted",
      );
    }
    const [row] = await tx
      .delete(experiments)
      .where(eq(experiments.id, experiment))
      .returning({ id: experiments.id });
    if (!row) {
      throw new ExperimentNotFoundError(`Unknown experiment: ${experiment}`);
    }
  });
}

async function designLocked(
  experimentId: string,
  tx: Executor,
): Promise<boolean> {
  const [observation] = await tx
    .select({ id: experimentObservations.id })
    .from(experimentObservations)
    .where(eq(experimentObservations.experimentId, experimentId))
    .limit(1);
  return observation !== undefined;
}

async function requireOpenDesign(
  experimentId: string,
  tx: Executor,
): Promise<void> {
  if (await designLocked(experimentId, tx)) {
    throw new ExperimentDesignLockedError(
      "The design is fixed after the first observation",
    );
  }
}

export async function addTreatment(
  value: TreatmentRequest,
): Promise<Treatment> {
  const {
    experiment: experimentId,
    name,
    factors,
    note,
    replicates,
    initialExplantCount,
  } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
    const existing = await listTreatments(experimentId, tx);
    if (
      existing.some(
        (treatment) => dishLabelKey(treatment.name) === dishLabelKey(name),
      )
    ) {
      throw new TreatmentRejectedError(`Treatment ${name} already exists`);
    }
    const [row] = await tx
      .insert(experimentTreatments)
      .values({
        experimentId,
        id: randomUUID(),
        name,
        factors,
        note,
        position: existing.length + 1,
      })
      .returning();
    if (!row) throw new Error("Treatment was not created");
    if (replicates > 0) {
      const taken = (await listDishes(experimentId, tx)).map(
        (dish) => dish.label,
      );
      await insertDishes(
        experimentId,
        row.id,
        replicateLabels(name, replicates, taken),
        initialExplantCount,
        tx,
      );
    }
    return toTreatment(row);
  });
}

export async function addTreatmentReplicates(
  value: TreatmentReplicates,
): Promise<DishRecord[]> {
  const {
    experiment: experimentId,
    treatment: treatmentId,
    replicates,
    initialExplantCount,
  } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
    const treatment = await requireTreatment(experimentId, treatmentId, tx);
    const taken = (await listDishes(experimentId, tx)).map(
      (dish) => dish.label,
    );
    return insertDishes(
      experimentId,
      treatmentId,
      replicateLabels(treatment.name, replicates, taken),
      initialExplantCount,
      tx,
    );
  });
}

export async function updateTreatment(
  value: TreatmentUpdate,
): Promise<Treatment> {
  const { experiment: experimentId, treatment: treatmentId, ...design } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
    const taken = (await listTreatments(experimentId, tx)).find(
      (treatment) =>
        dishLabelKey(treatment.name) === dishLabelKey(design.name) &&
        treatment.id !== treatmentId,
    );
    if (taken) {
      throw new TreatmentRejectedError(
        `Treatment ${design.name} already exists`,
      );
    }
    const [row] = await tx
      .update(experimentTreatments)
      .set(design)
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
    await requireOpenDesign(experimentId, tx);
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

async function insertDishes(
  experimentId: string,
  treatmentId: string | null,
  labels: readonly string[],
  initialExplantCount: number,
  tx: Executor,
): Promise<DishRecord[]> {
  const rows = await tx
    .insert(experimentDishes)
    .values(
      labels.map((label) => ({
        experimentId,
        id: randomUUID(),
        label,
        treatmentId,
        initialExplantCount,
      })),
    )
    .returning();
  return rows.map((row) => toDish(row));
}

export async function addDishes(value: DishLayout): Promise<DishRecord[]> {
  const {
    experiment: experimentId,
    treatment: treatmentId,
    labels,
    initialExplantCount,
  } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
    if (treatmentId !== null)
      await requireTreatment(experimentId, treatmentId, tx);
    const wanted = new Set(labels.map(dishLabelKey));
    if (wanted.size !== labels.length) {
      throw new DishRejectedError("The same dish is listed twice");
    }
    const taken = (await listDishes(experimentId, tx))
      .map((dish) => dish.label)
      .filter((label) => wanted.has(dishLabelKey(label)));
    if (taken.length > 0) {
      throw new DishRejectedError(
        `The experiment already has ${taken.join(", ")}`,
      );
    }
    return insertDishes(
      experimentId,
      treatmentId,
      labels,
      initialExplantCount,
      tx,
    );
  });
}

export async function updateDish(value: DishUpdate): Promise<DishRecord> {
  const {
    experiment: experimentId,
    dish: dishId,
    label,
    initialExplantCount,
  } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const dishes = await listDishes(experimentId, tx);
    const current = dishes.find((dish) => dish.id === dishId);
    if (!current) throw new DishNotFoundError(`Unknown dish: ${dishId}`);
    if (
      current.initialExplantCount !== initialExplantCount &&
      (await designLocked(experimentId, tx))
    ) {
      throw new ExperimentDesignLockedError(
        "Initial explant count is fixed after the first observation",
      );
    }
    const clash = dishes.find(
      (dish) =>
        dishLabelKey(dish.label) === dishLabelKey(label) && dish.id !== dishId,
    );
    if (clash) {
      throw new DishRejectedError(`The experiment already has ${label}`);
    }
    const [row] = await tx
      .update(experimentDishes)
      .set({ label, initialExplantCount })
      .where(atDish(experimentId, dishId))
      .returning();
    if (!row) throw new DishNotFoundError(`Unknown dish: ${dishId}`);
    return toDish(row);
  });
}

export async function deleteDish(value: DishRef): Promise<void> {
  const { experiment: experimentId, dish: dishId } = value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
    const [row] = await tx
      .delete(experimentDishes)
      .where(atDish(experimentId, dishId))
      .returning({ id: experimentDishes.id });
    if (!row) throw new DishNotFoundError(`Unknown dish: ${dishId}`);
  });
}

async function requireTreatment(
  experimentId: string,
  treatmentId: string,
  tx: Executor,
): Promise<Treatment> {
  const [treatment] = await tx
    .select()
    .from(experimentTreatments)
    .where(atTreatment(experimentId, treatmentId));
  if (!treatment) {
    throw new TreatmentNotFoundError(`Unknown treatment: ${treatmentId}`);
  }
  return toTreatment(treatment);
}

export async function assignDishes(value: DishAssignment): Promise<void> {
  const { experiment: experimentId, dishes, treatment: treatmentId } = value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
    if (treatmentId !== null)
      await requireTreatment(experimentId, treatmentId, tx);
    const rows = await tx
      .update(experimentDishes)
      .set({ treatmentId })
      .where(
        and(
          eq(experimentDishes.experimentId, experimentId),
          inArray(experimentDishes.id, dishes),
        ),
      )
      .returning({ id: experimentDishes.id });
    const updated = new Set(rows.map((row) => row.id));
    const missing = dishes.filter((dish) => !updated.has(dish));
    if (missing.length > 0) {
      throw new DishNotFoundError(`Unknown dishes: ${missing.join(", ")}`);
    }
  });
}
