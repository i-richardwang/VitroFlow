import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { transaction } from "../db/client";
import {
  experimentCultureEvents,
  experimentObservationImages,
} from "../db/schema";
import {
  cultureEventIsTerminal,
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
  CultureEventRequest,
  CultureEventVoid,
} from "../experiments/schema";
import {
  listObservationUnits,
  listObservations,
  lockExperiment,
} from "./experiment-records";

export async function recordCultureEvent(
  value: CultureEventRequest,
): Promise<CultureEvent> {
  const {
    experiment: experimentId,
    observationUnit: observationUnitId,
    observation: observationId,
    type,
    excludeFromObservation,
    note,
  } = value;
  return transaction(async (tx) => {
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
        (event) =>
          event.voidedAt === null &&
          event.observation === observationId &&
          event.type === type,
      )
    ) {
      throw new ObservationUnitRejectedError(
        `${type} is already recorded for ${observationUnit.code} at this observation`,
      );
    }
    const hasActiveTerminalEvent = observationUnit.events.some(
      (event) => event.voidedAt === null && cultureEventIsTerminal(event.type),
    );
    if (cultureEventIsTerminal(type) && hasActiveTerminalEvent) {
      throw new ObservationUnitRejectedError(
        `${observationUnit.code} already has an active terminal event`,
      );
    }

    const ordinals = new Map(
      observations.map((item) => [item.id, item.ordinal]),
    );
    const ordinalOf = (id: string): number => {
      const ordinal = ordinals.get(id);
      if (ordinal === undefined) {
        throw new Error(`Unknown observation in experiment record: ${id}`);
      }
      return ordinal;
    };
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
          (image) => ordinalOf(image.observation) > observation.ordinal,
        ) ||
        observationUnit.events.some(
          (event) =>
            event.voidedAt === null &&
            ordinalOf(event.observation) > observation.ordinal,
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
        excludeFromObservation,
        note,
        recordedAt: new Date(),
        voidedAt: null,
        voidReason: "",
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

export async function voidCultureEvent(
  value: CultureEventVoid,
): Promise<CultureEvent> {
  const { experiment: experimentId, event: eventId, reason } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const [row] = await tx
      .update(experimentCultureEvents)
      .set({ voidedAt: new Date(), voidReason: reason })
      .where(
        and(
          eq(experimentCultureEvents.experimentId, experimentId),
          eq(experimentCultureEvents.id, eventId),
          sql`${experimentCultureEvents.voidedAt} is null`,
        ),
      )
      .returning({
        observationUnitId: experimentCultureEvents.observationUnitId,
      });
    if (!row) {
      throw new CultureEventNotFoundError(
        `Unknown active culture event: ${eventId}`,
      );
    }
    const observationUnit = (await listObservationUnits(experimentId, tx)).find(
      (item) => item.id === row.observationUnitId,
    );
    const event = observationUnit?.events.find((item) => item.id === eventId);
    if (!event) throw new Error("Voided culture event was not read back");
    return event;
  });
}
