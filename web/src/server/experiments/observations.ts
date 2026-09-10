import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { inTransaction, type Executor } from "../infra/db/client";
import { experimentObservations } from "../infra/db/schema";
import {
  ObservationNotFoundError,
  ObservationRejectedError,
} from "../../domain/experiments/errors";
import { ModelNotFoundError } from "../../domain/models/errors";
import {
  type Experiment,
  type ExperimentObservation,
  type ObservationRef,
  type ObservationRequest,
  type ObservationUpdate,
} from "../../domain/experiments/schema";
import {
  atObservation,
  listObservations,
  lockExperiment,
  requireObservation,
} from "./records";
import { readModel } from "../models/public";

function rejectBeforeInoculation(
  experiment: Experiment,
  observedOn: string,
): void {
  if (observedOn < experiment.inoculatedOn) {
    throw new ObservationRejectedError(
      `An observation cannot precede inoculation on ${experiment.inoculatedOn}`,
    );
  }
}

async function rejectSameDay(
  experimentId: string,
  observedOn: string,
  exceptObservationId: string | null,
  tx: Executor,
): Promise<void> {
  const rows = await tx
    .select({ id: experimentObservations.id })
    .from(experimentObservations)
    .where(
      and(
        eq(experimentObservations.experimentId, experimentId),
        eq(experimentObservations.observedOn, observedOn),
      ),
    );
  if (rows.some((row) => row.id !== exceptObservationId)) {
    throw new ObservationRejectedError(
      `The experiment already has an observation on ${observedOn}`,
    );
  }
}

/** An observation asks a question the registry holds a model for. */
async function rejectUnknownModel(
  modelId: string,
  tx: Executor,
): Promise<void> {
  if (!(await readModel(modelId, tx))) {
    throw new ModelNotFoundError(`Unknown model: ${modelId}`);
  }
}

export async function addObservation(
  value: ObservationRequest,
  executor?: Executor,
): Promise<ExperimentObservation> {
  const { experiment: experimentId, observedOn, note, modelId } = value;
  return inTransaction(executor, async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    rejectBeforeInoculation(experiment, observedOn);
    await rejectSameDay(experimentId, observedOn, null, tx);
    await rejectUnknownModel(modelId, tx);
    const [row] = await tx
      .insert(experimentObservations)
      .values({
        experimentId,
        id: randomUUID(),
        inoculatedOn: experiment.inoculatedOn,
        observedOn,
        note,
        modelId,
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Observation was not created");
    return requireObservation(await listObservations(experiment, tx), row.id);
  });
}

export async function updateObservation(
  value: ObservationUpdate,
  executor?: Executor,
): Promise<ExperimentObservation> {
  const {
    experiment: experimentId,
    observation: observationId,
    observedOn,
    note,
    modelId,
  } = value;
  return inTransaction(executor, async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    rejectBeforeInoculation(experiment, observedOn);
    await rejectSameDay(experimentId, observedOn, observationId, tx);
    await rejectUnknownModel(modelId, tx);
    const [row] = await tx
      .update(experimentObservations)
      .set({ observedOn, note, modelId })
      .where(atObservation(experimentId, observationId))
      .returning();
    if (!row) {
      throw new ObservationNotFoundError(
        `Unknown observation: ${observationId}`,
      );
    }
    return requireObservation(await listObservations(experiment, tx), row.id);
  });
}

export async function deleteObservation(
  value: ObservationRef,
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, observation: observationId } = value;
  await inTransaction(executor, async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observation = requireObservation(
      await listObservations(experiment, tx),
      observationId,
    );
    if (observation.hasRecords) {
      throw new ObservationRejectedError(
        "An observation with images or culture events cannot be deleted",
      );
    }
    const [row] = await tx
      .delete(experimentObservations)
      .where(atObservation(experimentId, observationId))
      .returning({ id: experimentObservations.id });
    if (!row) {
      throw new ObservationNotFoundError(
        `Unknown observation: ${observationId}`,
      );
    }
  });
}
