import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { inTransaction, type Executor } from "../db/client";
import {
  experimentCultureEvents,
  experimentObservationImages,
} from "../db/schema";
import {
  cultureEventIsTerminal,
  cultureEventLabel,
  observationOrdinal,
  observationOrdinals,
  observationUnitIsAvailableAt,
} from "../experiments/culture-events";
import {
  CultureEventNotFoundError,
  ObservationUnitNotFoundError,
  ObservationUnitRejectedError,
  ObservationNotFoundError,
} from "../experiments/errors";
import type {
  CultureEvent,
  CultureEventRef,
  CultureEventRequest,
} from "../experiments/schema";
import {
  listObservationUnits,
  listObservations,
  lockExperiment,
} from "./experiment-records";

export async function recordCultureEvent(
  value: CultureEventRequest,
  executor?: Executor,
): Promise<CultureEvent> {
  const {
    experiment: experimentId,
    observationUnit: observationUnitId,
    observation: observationId,
    type,
  } = value;
  return inTransaction(executor, async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const observations = await listObservations(experiment, tx);
    const observation = observations.find((item) => item.id === observationId);
    if (!observation) {
      throw new ObservationNotFoundError(
        `Unknown observation: ${observationId}`,
      );
    }
    const observationUnit = (await listObservationUnits(experimentId, tx)).find(
      (item) => item.id === observationUnitId,
    );
    if (!observationUnit)
      throw new ObservationUnitNotFoundError(
        `Unknown observation unit: ${observationUnitId}`,
      );
    if (
      observationUnit.events.some(
        (event) => event.observation === observationId && event.type === type,
      )
    ) {
      throw new ObservationUnitRejectedError(
        `${cultureEventLabel(type)} is already recorded for ${observationUnit.code} at this observation`,
      );
    }
    const hasTerminalEvent = observationUnit.events.some((event) =>
      cultureEventIsTerminal(event.type),
    );
    if (cultureEventIsTerminal(type) && hasTerminalEvent) {
      throw new ObservationUnitRejectedError(
        `${observationUnit.code} has already left the bench`,
      );
    }

    const ordinals = observationOrdinals(observations);
    if (
      !observationUnitIsAvailableAt(
        observationUnit.events,
        observation,
        ordinals,
      )
    ) {
      throw new ObservationUnitRejectedError(
        `Observation unit ${observationUnit.code} was already removed before this observation`,
      );
    }
    if (cultureEventIsTerminal(type)) {
      const imageObservations = await tx
        .select({ observation: experimentObservationImages.observationId })
        .from(experimentObservationImages)
        .where(
          and(
            eq(experimentObservationImages.experimentId, experimentId),
            eq(
              experimentObservationImages.observationUnitId,
              observationUnitId,
            ),
          ),
        );
      const hasLaterRecord =
        imageObservations.some(
          (image) =>
            observationOrdinal(ordinals, image.observation) >
            observation.ordinal,
        ) ||
        observationUnit.events.some(
          (event) =>
            observationOrdinal(ordinals, event.observation) >
            observation.ordinal,
        );
      if (hasLaterRecord) {
        throw new ObservationUnitRejectedError(
          `Observation unit ${observationUnit.code} has records after this observation and cannot be removed here`,
        );
      }
    }

    const [row] = await tx
      .insert(experimentCultureEvents)
      .values({
        experimentId,
        id: randomUUID(),
        observationUnitId,
        observationId,
        type,
        recordedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Culture event was not recorded");
    const updated = (await listObservationUnits(experimentId, tx)).find(
      (item) => item.id === observationUnitId,
    );
    const event = updated?.events.find((item) => item.id === row.id);
    if (!event) throw new Error("Culture event was not read back");
    return event;
  });
}

/** Erases an event that was recorded by mistake. */
export async function deleteCultureEvent(
  { experiment: experimentId, event: eventId }: CultureEventRef,
  executor?: Executor,
): Promise<void> {
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const [row] = await tx
      .delete(experimentCultureEvents)
      .where(
        and(
          eq(experimentCultureEvents.experimentId, experimentId),
          eq(experimentCultureEvents.id, eventId),
        ),
      )
      .returning({ id: experimentCultureEvents.id });
    if (!row) {
      throw new CultureEventNotFoundError(`Unknown culture event: ${eventId}`);
    }
  });
}
