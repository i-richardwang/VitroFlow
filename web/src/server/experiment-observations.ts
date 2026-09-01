import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { transaction, type Executor } from "../db/client";
import { experimentObservations } from "../db/schema";
import { designIssues } from "../experiments/design";
import {
  ExperimentDesignIncompleteError,
  ObservationNotFoundError,
  ObservationRejectedError,
} from "../experiments/errors";
import {
  type Experiment,
  type ExperimentObservation,
  type ObservationRef,
  type ObservationRequest,
  type ObservationUpdate,
} from "../experiments/schema";
import {
  atObservation,
  listObservationUnits,
  listObservations,
  listTreatments,
  lockExperiment,
  requireObservation,
} from "./experiment-records";

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

export async function addObservation(
  value: ObservationRequest,
): Promise<ExperimentObservation> {
  const { experiment: experimentId, observedOn, note } = value;
  return transaction(async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    rejectBeforeInoculation(experiment, observedOn);
    const [treatments, observationUnits] = await Promise.all([
      listTreatments(experimentId, tx),
      listObservationUnits(experimentId, tx),
    ]);
    const issues = designIssues(treatments, observationUnits);
    if (issues.length > 0) {
      throw new ExperimentDesignIncompleteError(issues.join(". "));
    }
    await rejectSameDay(experimentId, observedOn, null, tx);
    const [row] = await tx
      .insert(experimentObservations)
      .values({
        experimentId,
        id: randomUUID(),
        inoculatedOn: experiment.inoculatedOn,
        observedOn,
        note,
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Observation was not created");
    return requireObservation(await listObservations(experiment, tx), row.id);
  });
}

export async function updateObservation(
  value: ObservationUpdate,
): Promise<ExperimentObservation> {
  const {
    experiment: experimentId,
    observation: observationId,
    observedOn,
    note,
  } = value;
  return transaction(async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    rejectBeforeInoculation(experiment, observedOn);
    await rejectSameDay(experimentId, observedOn, observationId, tx);
    const current = requireObservation(
      await listObservations(experiment, tx),
      observationId,
    );
    if (current.hasRecords && observedOn !== current.observedOn) {
      throw new ObservationRejectedError(
        "The date is fixed once an observation has images or culture events",
      );
    }
    const [row] = await tx
      .update(experimentObservations)
      .set({ observedOn, note })
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

export async function deleteObservation(value: ObservationRef): Promise<void> {
  const { experiment: experimentId, observation: observationId } = value;
  await transaction(async (tx) => {
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
