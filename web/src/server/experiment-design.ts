import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  experimentObservationUnits,
  experimentObservations,
  experimentTreatments,
  experiments,
} from "../db/schema";
import {
  ObservationUnitNotFoundError,
  ObservationUnitRejectedError,
  ExperimentDesignLockedError,
  ExperimentHasRecordsError,
  ExperimentNotFoundError,
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
  type TreatmentReplicates,
  type TreatmentUpdate,
} from "../experiments/schema";
import {
  atObservationUnit,
  type ObservationUnitRecord,
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
        page.plantMaterial !== current.plantMaterial ||
        page.explantType !== current.explantType ||
        page.baseMedium !== current.baseMedium ||
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
        factors,
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
        initialExplantCount,
        tx,
      );
    }
    return toTreatment(row);
  });
}

export async function addTreatmentReplicates(
  value: TreatmentReplicates,
): Promise<ObservationUnitRecord[]> {
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
    const taken = (await listObservationUnits(experimentId, tx)).map(
      (observationUnit) => observationUnit.code,
    );
    return insertObservationUnits(
      experimentId,
      treatmentId,
      replicateCodes(treatment.name, replicates, taken),
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

export async function deleteTreatment(value: TreatmentRef): Promise<void> {
  const { experiment: experimentId, treatment: treatmentId } = value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
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
  initialExplantCount: number,
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
        initialExplantCount,
      })),
    )
    .returning();
  return rows.map((row) => toObservationUnit(row));
}

export async function addObservationUnits(
  value: ObservationUnitBatch,
): Promise<ObservationUnitRecord[]> {
  const {
    experiment: experimentId,
    treatment: treatmentId,
    codes,
    initialExplantCount,
  } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
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
    return insertObservationUnits(
      experimentId,
      treatmentId,
      codes,
      initialExplantCount,
      tx,
    );
  });
}

export async function updateObservationUnit(
  value: ObservationUnitUpdate,
): Promise<ObservationUnitRecord> {
  const {
    experiment: experimentId,
    observationUnit: observationUnitId,
    code,
    initialExplantCount,
  } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const observationUnits = await listObservationUnits(experimentId, tx);
    const current = observationUnits.find(
      (observationUnit) => observationUnit.id === observationUnitId,
    );
    if (!current) {
      throw new ObservationUnitNotFoundError(
        `Unknown observation unit: ${observationUnitId}`,
      );
    }
    if (
      current.initialExplantCount !== initialExplantCount &&
      (await designLocked(experimentId, tx))
    ) {
      throw new ExperimentDesignLockedError(
        "Initial explant count is fixed after the first observation",
      );
    }
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
      .set({ code, initialExplantCount })
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
): Promise<void> {
  const { experiment: experimentId, observationUnit: observationUnitId } =
    value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
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
): Promise<void> {
  const {
    experiment: experimentId,
    observationUnits,
    treatment: treatmentId,
  } = value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    await requireOpenDesign(experimentId, tx);
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
