import { randomUUID } from "node:crypto";

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import { database, inTransaction, type Executor } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import {
  experimentCultureEvents,
  experimentObservationImages,
  experimentObservations,
  experimentTreatments,
  experimentUnits,
  experiments,
} from "../db/schema";
import type { UnitRecord } from "../experiments/contracts";
import {
  ExperimentHasRecordsError,
  ExperimentNotFoundError,
  ExperimentRejectedError,
  ModelVersionNotFoundError,
  ObservationRejectedError,
  TreatmentNotFoundError,
  TreatmentRejectedError,
  UnitNotFoundError,
  UnitRejectedError,
} from "../experiments/errors";
import { replicateCodes, sameName } from "../experiments/naming";
import {
  type Experiment,
  type ExperimentRef,
  type ExperimentRequest,
  type ExperimentUpdate,
  type ReplicateRequest,
  type Treatment,
  type TreatmentDesign,
  type TreatmentRef,
  type TreatmentRequest,
  type TreatmentUpdate,
  type UnitRef,
  type UnitUpdate,
} from "../experiments/schema";
import {
  atTreatment,
  atUnit,
  listTreatments,
  listUnits,
  lockExperiment,
  readExperimentRecord,
  toExperiment,
  toTreatment,
  toUnit,
} from "./experiment-records";
import { readModelVersion } from "./model-registry";

export async function readExperiment(
  experimentId: string,
): Promise<Experiment | null> {
  return readExperimentRecord(experimentId, await database());
}

/** An experiment starts with its design: every treatment laid out in replicates. */
export async function createExperiment(
  value: ExperimentRequest,
  executor?: Executor,
): Promise<Experiment> {
  const { treatments, ...page } = value;
  return inTransaction(executor, async (tx) => {
    const version = await readModelVersion(page.modelVersionId, tx);
    if (!version) {
      throw new ModelVersionNotFoundError(
        `Unknown model version: ${page.modelVersionId}`,
      );
    }
    const [row] = await refuseTakenName(page.name, () =>
      tx
        .insert(experiments)
        .values({ ...page, id: randomUUID(), createdAt: new Date() })
        .returning(),
    );
    if (!row) throw new Error("Experiment was not created");
    for (const [index, treatment] of treatments.entries()) {
      await insertTreatment(row.id, treatment, index + 1, [], tx);
    }
    return toExperiment(row);
  });
}

/** Two experiments cannot read the same name, whatever its case. */
async function refuseTakenName<T>(
  name: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isUniqueViolation(error, "experiments_name")) throw error;
    throw new ExperimentRejectedError(
      `An experiment named ${name} already exists`,
    );
  }
}

export async function updateExperiment(
  value: ExperimentUpdate,
  executor?: Executor,
): Promise<Experiment> {
  const { experiment: experimentId, ...page } = value;
  return inTransaction(executor, async (tx) => {
    const current = await lockExperiment(experimentId, tx);
    if (page.inoculatedOn !== current.inoculatedOn) {
      const [early] = await tx
        .select({ observedOn: experimentObservations.observedOn })
        .from(experimentObservations)
        .where(
          and(
            eq(experimentObservations.experimentId, experimentId),
            lt(experimentObservations.observedOn, page.inoculatedOn),
          ),
        )
        .limit(1);
      if (early) {
        throw new ObservationRejectedError(
          `An observation cannot precede inoculation on ${page.inoculatedOn}`,
        );
      }
    }
    const [row] = await refuseTakenName(page.name, () =>
      tx
        .update(experiments)
        .set(page)
        .where(eq(experiments.id, experimentId))
        .returning(),
    );
    if (!row) {
      throw new ExperimentNotFoundError(`Unknown experiment: ${experimentId}`);
    }
    return toExperiment(row);
  });
}

export async function deleteExperiment(
  value: ExperimentRef,
  executor?: Executor,
): Promise<void> {
  const { experiment } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experiment, tx);
    if (await hasRecords(experiment, null, tx)) {
      throw new ExperimentHasRecordsError(
        "An experiment with images or culture events cannot be deleted",
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

type RecordScope = { treatment: string } | { unit: string } | null;

/**
 * Whether images or culture events were recorded: on the whole experiment,
 * on one treatment's units, or on one unit.
 */
async function hasRecords(
  experimentId: string,
  scope: RecordScope,
  tx: Executor,
): Promise<boolean> {
  const inScope = (
    unitId:
      | typeof experimentObservationImages.unitId
      | typeof experimentCultureEvents.unitId,
  ) => {
    if (scope === null) return undefined;
    if ("unit" in scope) return eq(unitId, scope.unit);
    return inArray(
      unitId,
      tx
        .select({ id: experimentUnits.id })
        .from(experimentUnits)
        .where(
          and(
            eq(experimentUnits.experimentId, experimentId),
            eq(experimentUnits.treatmentId, scope.treatment),
          ),
        ),
    );
  };
  const [image] = await tx
    .select({ id: experimentObservationImages.id })
    .from(experimentObservationImages)
    .where(
      and(
        eq(experimentObservationImages.experimentId, experimentId),
        inScope(experimentObservationImages.unitId),
      ),
    )
    .limit(1);
  if (image) return true;
  const [event] = await tx
    .select({ id: experimentCultureEvents.id })
    .from(experimentCultureEvents)
    .where(
      and(
        eq(experimentCultureEvents.experimentId, experimentId),
        inScope(experimentCultureEvents.unitId),
      ),
    )
    .limit(1);
  return event !== undefined;
}

async function insertTreatment(
  experimentId: string,
  design: TreatmentDesign,
  position: number,
  existing: readonly Treatment[],
  tx: Executor,
): Promise<Treatment> {
  const { replicates, ...fields } = design;
  if (existing.some((treatment) => sameName(treatment.name, fields.name))) {
    throw new TreatmentRejectedError(`Treatment ${fields.name} already exists`);
  }
  const [row] = await tx
    .insert(experimentTreatments)
    .values({ experimentId, id: randomUUID(), ...fields, position })
    .returning();
  if (!row) throw new Error("Treatment was not created");
  const treatment = toTreatment(row);
  await insertReplicates(experimentId, treatment, replicates, tx);
  return treatment;
}

/** Lays out `T1-1` through `T1-n`, continuing any series the experiment has. */
async function insertReplicates(
  experimentId: string,
  treatment: Treatment,
  replicates: number,
  tx: Executor,
): Promise<UnitRecord[]> {
  const taken = (await listUnits(experimentId, tx)).map((unit) => unit.code);
  const rows = await tx
    .insert(experimentUnits)
    .values(
      replicateCodes(treatment.name, replicates, taken).map((code) => ({
        experimentId,
        id: randomUUID(),
        code,
        treatmentId: treatment.id,
      })),
    )
    .returning();
  return rows.map((row) => toUnit(row));
}

export async function addTreatment(
  value: TreatmentRequest,
  executor?: Executor,
): Promise<Treatment> {
  const { experiment: experimentId, ...design } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const existing = await listTreatments(experimentId, tx);
    return insertTreatment(
      experimentId,
      design,
      existing.length + 1,
      existing,
      tx,
    );
  });
}

export async function addReplicates(
  value: ReplicateRequest,
  executor?: Executor,
): Promise<UnitRecord[]> {
  const {
    experiment: experimentId,
    treatment: treatmentId,
    replicates,
  } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const treatment = await requireTreatment(experimentId, treatmentId, tx);
    return insertReplicates(experimentId, treatment, replicates, tx);
  });
}

export async function updateTreatment(
  value: TreatmentUpdate,
  executor?: Executor,
): Promise<Treatment> {
  const { experiment: experimentId, treatment: treatmentId, ...design } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const taken = (await listTreatments(experimentId, tx)).find(
      (treatment) =>
        sameName(treatment.name, design.name) && treatment.id !== treatmentId,
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

/** A treatment leaves with its units, which is why recorded ones stay. */
export async function deleteTreatment(
  value: TreatmentRef,
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, treatment: treatmentId } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    if (await hasRecords(experimentId, { treatment: treatmentId }, tx)) {
      throw new TreatmentRejectedError(
        "A treatment whose units have images or culture events cannot be deleted",
      );
    }
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

export async function updateUnit(
  value: UnitUpdate,
  executor?: Executor,
): Promise<UnitRecord> {
  const { experiment: experimentId, unit: unitId, code, treatment } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireTreatment(experimentId, treatment, tx);
    const clash = (await listUnits(experimentId, tx)).find(
      (unit) => sameName(unit.code, code) && unit.id !== unitId,
    );
    if (clash) {
      throw new UnitRejectedError(`The experiment already has ${code}`);
    }
    const [row] = await tx
      .update(experimentUnits)
      .set({ code, treatmentId: treatment })
      .where(atUnit(experimentId, unitId))
      .returning();
    if (!row) throw new UnitNotFoundError(`Unknown unit: ${unitId}`);
    return toUnit(row);
  });
}

export async function deleteUnit(
  value: UnitRef,
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, unit: unitId } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    if (await hasRecords(experimentId, { unit: unitId }, tx)) {
      throw new UnitRejectedError(
        "A unit with images or culture events cannot be deleted",
      );
    }
    const [row] = await tx
      .delete(experimentUnits)
      .where(atUnit(experimentId, unitId))
      .returning({ id: experimentUnits.id });
    if (!row) throw new UnitNotFoundError(`Unknown unit: ${unitId}`);
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
