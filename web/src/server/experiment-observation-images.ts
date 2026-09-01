import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { transaction } from "../db/client";
import {
  experimentObservationUnits,
  experimentObservationImages,
  experimentObservations,
  images,
} from "../db/schema";
import { observationUnitIsAvailableAt } from "../experiments/culture-events";
import {
  ExperimentObservationImageAlreadyUsedError,
  ExperimentObservationImageNotFoundError,
  ImagesNotStoredError,
  ObservationImageRejectedError,
  ObservationUnitNotFoundError,
} from "../experiments/errors";
import {
  daysBetween,
  type ObservationImageAssignment,
  type ObservationImageAssignmentResult,
  type ObservationImageMove,
  type ObservationImageRef,
} from "../experiments/schema";
import {
  listObservationUnits,
  listObservations,
  lockExperiment,
  requireObservation,
} from "./experiment-records";
import { readExperimentObservationImage } from "./experiment-queries";
import { lockImage } from "./image-lock";
import { clearDetectionFailure } from "./inference-outcomes";

export async function assignObservationImages(
  value: ObservationImageAssignment,
): Promise<ObservationImageAssignmentResult> {
  const {
    experiment: experimentId,
    observation: observationId,
    images: assignments,
  } = value;
  const observationUnitIds = assignments.map(
    (assignment) => assignment.observationUnit,
  );
  if (new Set(observationUnitIds).size !== observationUnitIds.length) {
    throw new ObservationImageRejectedError(
      "Two images cannot be assigned to the same observation unit",
    );
  }
  const digests = [
    ...new Set(assignments.map((assignment) => assignment.digest)),
  ].sort();
  if (digests.length !== assignments.length) {
    throw new ObservationImageRejectedError("The same image is assigned twice");
  }

  return transaction(async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observations = await listObservations(experiment, tx);
    const observation = requireObservation(observations, observationId);
    const ordinals = new Map(
      observations.map((item) => [item.id, item.ordinal]),
    );
    const observationUnits = await listObservationUnits(experimentId, tx);
    const byId = new Map(
      observationUnits.map((observationUnit) => [
        observationUnit.id,
        observationUnit,
      ]),
    );
    const unknown = observationUnitIds.filter(
      (observationUnit) => !byId.has(observationUnit),
    );
    if (unknown.length > 0) {
      throw new ObservationUnitNotFoundError(
        `Observation units do not belong to this experiment: ${unknown.join(", ")}`,
      );
    }
    const unavailable = observationUnitIds
      .map((observationUnitId) => byId.get(observationUnitId)!)
      .filter(
        (observationUnit) =>
          !observationUnitIsAvailableAt(
            observationUnit.events,
            observation,
            ordinals,
          ),
      );
    if (unavailable.length > 0) {
      throw new ObservationImageRejectedError(
        `Images cannot be assigned to observation units removed before this observation: ${unavailable.map((observationUnit) => observationUnit.code).join(", ")}`,
      );
    }

    for (const digest of digests) await lockImage(digest, tx);
    const stored = await tx
      .select({ id: images.id })
      .from(images)
      .where(inArray(images.id, digests));
    if (stored.length !== digests.length) {
      throw new ImagesNotStoredError(
        "Some images are no longer stored; upload them again",
      );
    }

    const used = await tx
      .select({
        digest: experimentObservationImages.imageId,
        filename: experimentObservationImages.filename,
        observationUnit: experimentObservationUnits.code,
        observedOn: experimentObservations.observedOn,
      })
      .from(experimentObservationImages)
      .innerJoin(
        experimentObservationUnits,
        and(
          eq(
            experimentObservationUnits.experimentId,
            experimentObservationImages.experimentId,
          ),
          eq(
            experimentObservationUnits.id,
            experimentObservationImages.observationUnitId,
          ),
        ),
      )
      .innerJoin(
        experimentObservations,
        and(
          eq(
            experimentObservations.experimentId,
            experimentObservationImages.experimentId,
          ),
          eq(
            experimentObservations.id,
            experimentObservationImages.observationId,
          ),
        ),
      )
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          inArray(experimentObservationImages.imageId, digests),
        ),
      );
    if (used.length > 0) {
      throw new ExperimentObservationImageAlreadyUsedError(
        used.map((row) => ({
          digest: row.digest,
          filename: row.filename,
          observationUnit: row.observationUnit,
          day: daysBetween(experiment.inoculatedOn, row.observedOn),
        })),
      );
    }

    const filled = await tx
      .select({
        observationUnit: experimentObservationImages.observationUnitId,
      })
      .from(experimentObservationImages)
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          eq(experimentObservationImages.observationId, observationId),
          inArray(
            experimentObservationImages.observationUnitId,
            observationUnitIds,
          ),
        ),
      );
    if (filled.length > 0) {
      throw new ObservationImageRejectedError(
        `Some observation units already have images on day ${observation.day}`,
      );
    }

    await tx.insert(experimentObservationImages).values(
      assignments.map((assignment) => ({
        experimentId,
        id: randomUUID(),
        observationUnitId: assignment.observationUnit,
        observationId,
        imageId: assignment.digest,
        filename: assignment.filename,
      })),
    );
    return { observation, assigned: assignments.length };
  });
}

export async function moveObservationImage(
  value: ObservationImageMove,
): Promise<void> {
  const {
    experiment: experimentId,
    observationImage: observationImageId,
    observationUnit,
    observation: observationId,
  } = value;
  await transaction(async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observations = await listObservations(experiment, tx);
    const observation = requireObservation(observations, observationId);
    const observationUnits = await listObservationUnits(experimentId, tx);
    const target = observationUnits.find((item) => item.id === observationUnit);
    if (!target) {
      throw new ObservationUnitNotFoundError(
        `Unknown observation unit: ${observationUnit}`,
      );
    }
    const ordinals = new Map(
      observations.map((item) => [item.id, item.ordinal]),
    );
    if (!observationUnitIsAvailableAt(target.events, observation, ordinals)) {
      throw new ObservationImageRejectedError(
        `${target.code} was removed before this observation`,
      );
    }
    const [taken] = await tx
      .select({ id: experimentObservationImages.id })
      .from(experimentObservationImages)
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          eq(experimentObservationImages.observationUnitId, observationUnit),
          eq(experimentObservationImages.observationId, observationId),
        ),
      );
    if (taken && taken.id !== observationImageId) {
      throw new ObservationImageRejectedError(
        "That observation unit already has an image for this observation",
      );
    }
    const [row] = await tx
      .update(experimentObservationImages)
      .set({ observationUnitId: observationUnit, observationId })
      .where(atObservationImage(experimentId, observationImageId))
      .returning({ id: experimentObservationImages.id });
    if (!row) {
      throw new ExperimentObservationImageNotFoundError(
        `Unknown observation image: ${observationImageId}`,
      );
    }
  });
}

export async function unassignObservationImage(
  value: ObservationImageRef,
): Promise<void> {
  const { experiment: experimentId, observationImage: observationImageId } =
    value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const [row] = await tx
      .delete(experimentObservationImages)
      .where(atObservationImage(experimentId, observationImageId))
      .returning({ id: experimentObservationImages.id });
    if (!row) {
      throw new ExperimentObservationImageNotFoundError(
        `Unknown observation image: ${observationImageId}`,
      );
    }
  });
}

function atObservationImage(experimentId: string, observationImageId: string) {
  return and(
    eq(experimentObservationImages.experimentId, experimentId),
    eq(experimentObservationImages.id, observationImageId),
  );
}

export async function retryObservationImageAnalysis(
  ref: ObservationImageRef,
): Promise<void> {
  await transaction(async (tx) => {
    const image = await readExperimentObservationImage(ref, tx);
    if (!image) {
      throw new ExperimentObservationImageNotFoundError(
        `Unknown observation image: ${ref.observationImage}`,
      );
    }
    await clearDetectionFailure(
      { digest: image.digest, versionId: image.modelVersionId },
      tx,
    );
  });
}
