import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { transaction, type Executor } from "../db/client";
import {
  experimentDishes,
  experimentObservations,
  experimentPhotos,
  images,
} from "../db/schema";
import { designIssues } from "../experiments/design";
import { dishIsAvailableAt } from "../experiments/dish-events";
import {
  DishNotFoundError,
  ExperimentDesignIncompleteError,
  ExperimentPhotoAlreadyUsedError,
  ExperimentPhotoNotFoundError,
  ImagesNotStoredError,
  ObservationNotFoundError,
  ObservationRejectedError,
  PhotoRejectedError,
} from "../experiments/errors";
import {
  daysBetween,
  type Experiment,
  type ExperimentObservation,
  type FilingResult,
  type ObservationRef,
  type ObservationRequest,
  type ObservationUpdate,
  type PhotoFiling,
  type PhotoMove,
  type PhotoRef,
} from "../experiments/schema";
import {
  atObservation,
  listDishes,
  listObservations,
  listTreatments,
  lockExperiment,
} from "./experiment-records";
import { lockImage } from "./image-lock";
import { clearDetectionFailure } from "./inference-outcomes";
import { readExperimentPhoto } from "./experiment-queries";

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
      `The experiment was already observed on ${observedOn}`,
    );
  }
}

function findObservation(
  observations: ExperimentObservation[],
  observationId: string,
): ExperimentObservation {
  const observation = observations.find((item) => item.id === observationId);
  if (!observation) {
    throw new ObservationNotFoundError(`Unknown observation: ${observationId}`);
  }
  return observation;
}

export async function addObservation(
  value: ObservationRequest,
): Promise<ExperimentObservation> {
  const { experiment: experimentId, observedOn, note } = value;
  return transaction(async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    rejectBeforeInoculation(experiment, observedOn);
    const [treatments, dishes] = await Promise.all([
      listTreatments(experimentId, tx),
      listDishes(experimentId, tx),
    ]);
    const issues = designIssues(treatments, dishes);
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
    return findObservation(await listObservations(experiment, tx), row.id);
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
    const current = findObservation(
      await listObservations(experiment, tx),
      observationId,
    );
    if (current.hasRecords && observedOn !== current.observedOn) {
      throw new ObservationRejectedError(
        "The date is fixed once an observation has photographs or culture events",
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
    return findObservation(await listObservations(experiment, tx), row.id);
  });
}

export async function deleteObservation(value: ObservationRef): Promise<void> {
  const { experiment: experimentId, observation: observationId } = value;
  await transaction(async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observation = findObservation(
      await listObservations(experiment, tx),
      observationId,
    );
    if (observation.hasRecords) {
      throw new ObservationRejectedError(
        "An observation with photographs or culture events cannot be deleted",
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

export async function filePhotos(value: PhotoFiling): Promise<FilingResult> {
  const {
    experiment: experimentId,
    observation: observationId,
    photos,
  } = value;
  const dishIds = photos.map((photo) => photo.dish);
  if (new Set(dishIds).size !== dishIds.length) {
    throw new PhotoRejectedError("Two photographs are filed under one dish");
  }
  const digests = [...new Set(photos.map((photo) => photo.digest))].sort();
  if (digests.length !== photos.length) {
    throw new PhotoRejectedError("The same photograph is filed twice");
  }

  return transaction(async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observations = await listObservations(experiment, tx);
    const observation = findObservation(observations, observationId);
    const ordinals = new Map(
      observations.map((item) => [item.id, item.ordinal]),
    );
    const dishes = await listDishes(experimentId, tx);
    const byId = new Map(dishes.map((dish) => [dish.id, dish]));
    const unknown = dishIds.filter((dish) => !byId.has(dish));
    if (unknown.length > 0) {
      throw new DishNotFoundError(
        `Not dishes of this experiment: ${unknown.join(", ")}`,
      );
    }
    const unavailable = dishIds
      .map((dishId) => byId.get(dishId)!)
      .filter((dish) => !dishIsAvailableAt(dish.events, observation, ordinals));
    if (unavailable.length > 0) {
      throw new PhotoRejectedError(
        `${unavailable.map((dish) => dish.label).join(", ")} had already been removed`,
      );
    }

    for (const digest of digests) await lockImage(digest, tx);
    const stored = await tx
      .select({ id: images.id })
      .from(images)
      .where(inArray(images.id, digests));
    if (stored.length !== digests.length) {
      throw new ImagesNotStoredError(
        "Some photos are no longer stored; upload them again",
      );
    }

    const used = await tx
      .select({
        digest: experimentPhotos.imageId,
        filename: experimentPhotos.filename,
        dish: experimentDishes.label,
        observedOn: experimentObservations.observedOn,
      })
      .from(experimentPhotos)
      .innerJoin(
        experimentDishes,
        and(
          eq(experimentDishes.experimentId, experimentPhotos.experimentId),
          eq(experimentDishes.id, experimentPhotos.dishId),
        ),
      )
      .innerJoin(
        experimentObservations,
        and(
          eq(
            experimentObservations.experimentId,
            experimentPhotos.experimentId,
          ),
          eq(experimentObservations.id, experimentPhotos.observationId),
        ),
      )
      .where(
        and(
          eq(experimentPhotos.experimentId, experimentId),
          inArray(experimentPhotos.imageId, digests),
        ),
      );
    if (used.length > 0) {
      throw new ExperimentPhotoAlreadyUsedError(
        used.map((row) => ({
          digest: row.digest,
          filename: row.filename,
          dish: row.dish,
          day: daysBetween(experiment.inoculatedOn, row.observedOn),
        })),
      );
    }

    const filled = await tx
      .select({ dish: experimentPhotos.dishId })
      .from(experimentPhotos)
      .where(
        and(
          eq(experimentPhotos.experimentId, experimentId),
          eq(experimentPhotos.observationId, observationId),
          inArray(experimentPhotos.dishId, dishIds),
        ),
      );
    if (filled.length > 0) {
      throw new PhotoRejectedError(
        `Some dishes are already photographed on day ${observation.day}`,
      );
    }

    await tx.insert(experimentPhotos).values(
      photos.map((photo) => ({
        experimentId,
        id: randomUUID(),
        dishId: photo.dish,
        observationId,
        imageId: photo.digest,
        filename: photo.filename,
      })),
    );
    return { observation, photos: photos.length };
  });
}

export async function movePhoto(value: PhotoMove): Promise<void> {
  const {
    experiment: experimentId,
    photo: photoId,
    dish,
    observation: observationId,
  } = value;
  await transaction(async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observations = await listObservations(experiment, tx);
    const observation = findObservation(observations, observationId);
    const dishes = await listDishes(experimentId, tx);
    const target = dishes.find((item) => item.id === dish);
    if (!target) throw new DishNotFoundError(`Unknown dish: ${dish}`);
    const ordinals = new Map(
      observations.map((item) => [item.id, item.ordinal]),
    );
    if (!dishIsAvailableAt(target.events, observation, ordinals)) {
      throw new PhotoRejectedError(
        `${target.label} had already been removed by this observation`,
      );
    }
    const [taken] = await tx
      .select({ id: experimentPhotos.id })
      .from(experimentPhotos)
      .where(
        and(
          eq(experimentPhotos.experimentId, experimentId),
          eq(experimentPhotos.dishId, dish),
          eq(experimentPhotos.observationId, observationId),
        ),
      );
    if (taken && taken.id !== photoId) {
      throw new PhotoRejectedError("That cell already has a photograph");
    }
    const [row] = await tx
      .update(experimentPhotos)
      .set({ dishId: dish, observationId })
      .where(atPhoto(experimentId, photoId))
      .returning({ id: experimentPhotos.id });
    if (!row) {
      throw new ExperimentPhotoNotFoundError(`Unknown photograph: ${photoId}`);
    }
  });
}

export async function removePhoto(value: PhotoRef): Promise<void> {
  const { experiment: experimentId, photo: photoId } = value;
  await transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const [row] = await tx
      .delete(experimentPhotos)
      .where(atPhoto(experimentId, photoId))
      .returning({ id: experimentPhotos.id });
    if (!row) {
      throw new ExperimentPhotoNotFoundError(`Unknown photograph: ${photoId}`);
    }
  });
}

function atPhoto(experimentId: string, photoId: string) {
  return and(
    eq(experimentPhotos.experimentId, experimentId),
    eq(experimentPhotos.id, photoId),
  );
}

export async function retryExperimentDetection(ref: PhotoRef): Promise<void> {
  await transaction(async (tx) => {
    const photo = await readExperimentPhoto(ref, tx);
    if (!photo) {
      throw new ExperimentPhotoNotFoundError(
        `Unknown photograph: ${ref.photo}`,
      );
    }
    await clearDetectionFailure(
      { digest: photo.digest, versionId: photo.modelVersionId },
      tx,
    );
  });
}
