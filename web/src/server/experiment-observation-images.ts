import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { inTransaction, type Executor } from "../db/client";
import {
  experimentUnits,
  experimentObservationImages,
  experimentObservations,
  images,
} from "../db/schema";
import {
  observationOrdinals,
  unitIsAvailableAt,
} from "../experiments/culture-events";
import {
  ExperimentObservationImageAlreadyUsedError,
  ExperimentObservationImageNotFoundError,
  ImagesNotStoredError,
  ObservationImageRejectedError,
  UnitNotFoundError,
} from "../experiments/errors";
import {
  daysBetween,
  type ObservationImageAssignment,
  type ObservationImageAssignmentResult,
  type ObservationImageMove,
  type ObservationImageRef,
} from "../experiments/schema";
import {
  listUnits,
  listObservations,
  lockExperiment,
  requireObservation,
} from "./experiment-records";
import { readExperimentObservationImage } from "./experiment-queries";
import { lockImage } from "./image-lock";
import { clearDetectionFailure } from "./inference-outcomes";

export async function assignObservationImages(
  value: ObservationImageAssignment,
  executor?: Executor,
): Promise<ObservationImageAssignmentResult> {
  const {
    experiment: experimentId,
    observation: observationId,
    images: assignments,
  } = value;
  const unitIds = assignments.map((assignment) => assignment.unit);
  if (new Set(unitIds).size !== unitIds.length) {
    throw new ObservationImageRejectedError(
      "Two images cannot be assigned to the same unit",
    );
  }
  const digests = [
    ...new Set(assignments.map((assignment) => assignment.digest)),
  ].sort();
  if (digests.length !== assignments.length) {
    throw new ObservationImageRejectedError("The same image is assigned twice");
  }

  return inTransaction(executor, async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observations = await listObservations(experiment, tx);
    const observation = requireObservation(observations, observationId);
    const ordinals = observationOrdinals(observations);
    const units = await listUnits(experimentId, tx);
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const unknown = unitIds.filter((unit) => !byId.has(unit));
    if (unknown.length > 0) {
      throw new UnitNotFoundError(
        `Units do not belong to this experiment: ${unknown.join(", ")}`,
      );
    }
    const unavailable = unitIds
      .map((unitId) => byId.get(unitId)!)
      .filter((unit) => !unitIsAvailableAt(unit.events, observation, ordinals));
    if (unavailable.length > 0) {
      throw new ObservationImageRejectedError(
        `Images cannot be assigned to units removed before this observation: ${unavailable.map((unit) => unit.code).join(", ")}`,
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
        unit: experimentUnits.code,
        observedOn: experimentObservations.observedOn,
      })
      .from(experimentObservationImages)
      .innerJoin(
        experimentUnits,
        and(
          eq(
            experimentUnits.experimentId,
            experimentObservationImages.experimentId,
          ),
          eq(experimentUnits.id, experimentObservationImages.unitId),
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
          unit: row.unit,
          day: daysBetween(experiment.inoculatedOn, row.observedOn),
        })),
      );
    }

    const filled = await tx
      .select({
        unit: experimentObservationImages.unitId,
      })
      .from(experimentObservationImages)
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          eq(experimentObservationImages.observationId, observationId),
          inArray(experimentObservationImages.unitId, unitIds),
        ),
      );
    if (filled.length > 0) {
      throw new ObservationImageRejectedError(
        `Some units already have images on day ${observation.day}`,
      );
    }

    await tx.insert(experimentObservationImages).values(
      assignments.map((assignment) => ({
        experimentId,
        id: randomUUID(),
        unitId: assignment.unit,
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
  executor?: Executor,
): Promise<void> {
  const {
    experiment: experimentId,
    observationImage: observationImageId,
    unit,
    observation: observationId,
  } = value;
  await inTransaction(executor, async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observations = await listObservations(experiment, tx);
    const observation = requireObservation(observations, observationId);
    const units = await listUnits(experimentId, tx);
    const target = units.find((item) => item.id === unit);
    if (!target) {
      throw new UnitNotFoundError(`Unknown unit: ${unit}`);
    }
    const ordinals = observationOrdinals(observations);
    if (!unitIsAvailableAt(target.events, observation, ordinals)) {
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
          eq(experimentObservationImages.unitId, unit),
          eq(experimentObservationImages.observationId, observationId),
        ),
      );
    if (taken && taken.id !== observationImageId) {
      throw new ObservationImageRejectedError(
        "That unit already has an image for this observation",
      );
    }
    const [row] = await tx
      .update(experimentObservationImages)
      .set({ unitId: unit, observationId })
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
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, observationImage: observationImageId } =
    value;
  await inTransaction(executor, async (tx) => {
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
  executor?: Executor,
): Promise<void> {
  await inTransaction(executor, async (tx) => {
    const image = await readExperimentObservationImage(ref, tx);
    if (!image) {
      throw new ExperimentObservationImageNotFoundError(
        `Unknown observation image: ${ref.observationImage}`,
      );
    }
    if (!image.failure) return;
    await clearDetectionFailure(
      {
        digest: image.review.ref.digest,
        versionId: image.failure.producer.modelVersionId,
      },
      tx,
    );
  });
}
