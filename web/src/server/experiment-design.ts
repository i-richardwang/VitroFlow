import { randomUUID } from "node:crypto";

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import { database, inTransaction, type Executor } from "../db/client";
import {
  experimentCultureEvents,
  experimentObservationImages,
  experimentObservationUnits,
  experimentObservations,
  experimentTreatments,
  experiments,
} from "../db/schema";
import type { ObservationUnitRecord } from "../experiments/contracts";
import {
  ExperimentHasRecordsError,
  ExperimentNotFoundError,
  ModelVersionNotFoundError,
  ObservationRejectedError,
  ObservationUnitNotFoundError,
  ObservationUnitRejectedError,
  TreatmentNotFoundError,
  TreatmentRejectedError,
} from "../experiments/errors";
import {
  observationUnitCodeKey,
  replicateCodes,
  treatmentNameKey,
} from "../experiments/naming";
import {
  type ObservationUnitAssignment,
  type ObservationUnitBatch,
  type ObservationUnitRef,
  type ObservationUnitUpdate,
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
  atObservationUnit,
  atTreatment,
  listObservationUnits,
  listTreatments,
  lockExperiment,
  readExperimentRecord,
  toObservationUnit,
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
  executor?: Executor,
): Promise<Experiment> {
  return inTransaction(executor, async (tx) => {
    const { modelVersionId } = value;
    const version = await readModelVersion(modelVersionId, tx);
    if (!version) {
      throw new ModelVersionNotFoundError(
        `Unknown model version: ${modelVersionId}`,
      );
    }
    const [row] = await tx
      .insert(experiments)
      .values({ ...value, id: randomUUID(), createdAt: new Date() })
      .returning();
    if (!row) throw new Error("Experiment was not created");
    return toExperiment(row);
  });
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

export async function deleteExperiment(
  value: ExperimentRef,
  executor?: Executor,
): Promise<void> {
  const { experiment } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experiment, tx);
    if (await experimentHasRecords(experiment, tx)) {
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

async function experimentHasRecords(
  experimentId: string,
  tx: Executor,
): Promise<boolean> {
  const [image] = await tx
    .select({ id: experimentObservationImages.id })
    .from(experimentObservationImages)
    .where(eq(experimentObservationImages.experimentId, experimentId))
    .limit(1);
  if (image) return true;
  const [event] = await tx
    .select({ id: experimentCultureEvents.id })
    .from(experimentCultureEvents)
    .where(eq(experimentCultureEvents.experimentId, experimentId))
    .limit(1);
  return event !== undefined;
}

async function observationUnitHasRecords(
  experimentId: string,
  observationUnitId: string,
  tx: Executor,
): Promise<boolean> {
  const [image] = await tx
    .select({ id: experimentObservationImages.id })
    .from(experimentObservationImages)
    .where(
      and(
        eq(experimentObservationImages.experimentId, experimentId),
        eq(experimentObservationImages.observationUnitId, observationUnitId),
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
        eq(experimentCultureEvents.observationUnitId, observationUnitId),
      ),
    )
    .limit(1);
  return event !== undefined;
}

export async function addTreatment(
  value: TreatmentRequest,
  executor?: Executor,
): Promise<Treatment> {
  const { experiment: experimentId, name, factor, note, replicates } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const existing = await listTreatments(experimentId, tx);
    if (
      existing.some(
        (treatment) =>
          treatmentNameKey(treatment.name) === treatmentNameKey(name),
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
        factor,
        note,
        position: existing.length + 1,
      })
      .returning();
    if (!row) throw new Error("Treatment was not created");
    if (replicates > 0) {
      const taken = (await listObservationUnits(experimentId, tx)).map(
        (observationUnit) => observationUnit.code,
      );
      await insertObservationUnits(
        experimentId,
        row.id,
        replicateCodes(name, replicates, taken),
        tx,
      );
    }
    return toTreatment(row);
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
        treatmentNameKey(treatment.name) === treatmentNameKey(design.name) &&
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

export async function deleteTreatment(
  value: TreatmentRef,
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, treatment: treatmentId } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    await tx
      .update(experimentObservationUnits)
      .set({ treatmentId: null })
      .where(
        and(
          eq(experimentObservationUnits.experimentId, experimentId),
          eq(experimentObservationUnits.treatmentId, treatmentId),
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

async function insertObservationUnits(
  experimentId: string,
  treatmentId: string | null,
  codes: readonly string[],
  tx: Executor,
): Promise<ObservationUnitRecord[]> {
  const rows = await tx
    .insert(experimentObservationUnits)
    .values(
      codes.map((code) => ({
        experimentId,
        id: randomUUID(),
        code,
        treatmentId,
      })),
    )
    .returning();
  return rows.map((row) => toObservationUnit(row));
}

export async function addObservationUnits(
  value: ObservationUnitBatch,
  executor?: Executor,
): Promise<ObservationUnitRecord[]> {
  const { experiment: experimentId, treatment: treatmentId, codes } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    if (treatmentId !== null)
      await requireTreatment(experimentId, treatmentId, tx);
    const wanted = new Set(codes.map(observationUnitCodeKey));
    if (wanted.size !== codes.length) {
      throw new ObservationUnitRejectedError(
        "The same observation unit is listed twice",
      );
    }
    const taken = (await listObservationUnits(experimentId, tx))
      .map((observationUnit) => observationUnit.code)
      .filter((code) => wanted.has(observationUnitCodeKey(code)));
    if (taken.length > 0) {
      throw new ObservationUnitRejectedError(
        `The experiment already has ${taken.join(", ")}`,
      );
    }
    return insertObservationUnits(experimentId, treatmentId, codes, tx);
  });
}

export async function updateObservationUnit(
  value: ObservationUnitUpdate,
  executor?: Executor,
): Promise<ObservationUnitRecord> {
  const {
    experiment: experimentId,
    observationUnit: observationUnitId,
    code,
  } = value;
  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const observationUnits = await listObservationUnits(experimentId, tx);
    const clash = observationUnits.find(
      (observationUnit) =>
        observationUnitCodeKey(observationUnit.code) ===
          observationUnitCodeKey(code) &&
        observationUnit.id !== observationUnitId,
    );
    if (clash) {
      throw new ObservationUnitRejectedError(
        `The experiment already has ${code}`,
      );
    }
    const [row] = await tx
      .update(experimentObservationUnits)
      .set({ code })
      .where(atObservationUnit(experimentId, observationUnitId))
      .returning();
    if (!row) {
      throw new ObservationUnitNotFoundError(
        `Unknown observation unit: ${observationUnitId}`,
      );
    }
    return toObservationUnit(row);
  });
}

export async function deleteObservationUnit(
  value: ObservationUnitRef,
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, observationUnit: observationUnitId } =
    value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    if (await observationUnitHasRecords(experimentId, observationUnitId, tx)) {
      throw new ObservationUnitRejectedError(
        "An observation unit with images or culture events cannot be deleted",
      );
    }
    const [row] = await tx
      .delete(experimentObservationUnits)
      .where(atObservationUnit(experimentId, observationUnitId))
      .returning({ id: experimentObservationUnits.id });
    if (!row) {
      throw new ObservationUnitNotFoundError(
        `Unknown observation unit: ${observationUnitId}`,
      );
    }
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

export async function assignObservationUnits(
  value: ObservationUnitAssignment,
  executor?: Executor,
): Promise<void> {
  const {
    experiment: experimentId,
    observationUnits,
    treatment: treatmentId,
  } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    if (treatmentId !== null)
      await requireTreatment(experimentId, treatmentId, tx);
    const rows = await tx
      .update(experimentObservationUnits)
      .set({ treatmentId })
      .where(
        and(
          eq(experimentObservationUnits.experimentId, experimentId),
          inArray(experimentObservationUnits.id, observationUnits),
        ),
      )
      .returning({ id: experimentObservationUnits.id });
    const updated = new Set(rows.map((row) => row.id));
    const missing = observationUnits.filter(
      (observationUnit) => !updated.has(observationUnit),
    );
    if (missing.length > 0) {
      throw new ObservationUnitNotFoundError(
        `Unknown observation units: ${missing.join(", ")}`,
      );
    }
  });
}
