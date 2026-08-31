import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { transaction } from "../db/client";
import { experimentDishEvents, experimentPhotos } from "../db/schema";
import { dishIsAvailableAt } from "../experiments/dish-events";
import {
  DishEventNotFoundError,
  DishNotFoundError,
  DishRejectedError,
  ObservationNotFoundError,
} from "../experiments/errors";
import type {
  DishEvent,
  DishEventRequest,
  DishEventVoid,
} from "../experiments/schema";
import {
  listDishes,
  listObservations,
  lockExperiment,
} from "./experiment-records";

export async function recordDishEvent(
  value: DishEventRequest,
): Promise<DishEvent> {
  const {
    experiment: experimentId,
    dish: dishId,
    observation: observationId,
    type,
    excludeFromObservation,
    removeAfterObservation,
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
    const dish = (await listDishes(experimentId, tx)).find(
      (item) => item.id === dishId,
    );
    if (!dish) throw new DishNotFoundError(`Unknown dish: ${dishId}`);
    if (
      dish.events.some(
        (event) =>
          event.voidedAt === null &&
          event.observation === observationId &&
          event.type === type,
      )
    ) {
      throw new DishRejectedError(
        `${type} is already recorded for ${dish.label} at this observation`,
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
    if (!dishIsAvailableAt(dish.events, observation, ordinals)) {
      throw new DishRejectedError(
        `Dish ${dish.label} was already removed before this observation`,
      );
    }
    if (removeAfterObservation) {
      const photoObservations = await tx
        .select({ observation: experimentPhotos.observationId })
        .from(experimentPhotos)
        .where(
          and(
            eq(experimentPhotos.experimentId, experimentId),
            eq(experimentPhotos.dishId, dishId),
          ),
        );
      const hasLaterRecord =
        photoObservations.some(
          (photo) => ordinalOf(photo.observation) > observation.ordinal,
        ) ||
        dish.events.some(
          (event) =>
            event.voidedAt === null &&
            ordinalOf(event.observation) > observation.ordinal,
        );
      if (hasLaterRecord) {
        throw new DishRejectedError(
          `Dish ${dish.label} has records after this observation and cannot be removed here`,
        );
      }
    }

    const [row] = await tx
      .insert(experimentDishEvents)
      .values({
        experimentId,
        id: randomUUID(),
        dishId,
        observationId,
        type,
        excludeFromObservation,
        removeAfterObservation,
        note,
        recordedAt: new Date(),
        voidedAt: null,
        voidReason: "",
      })
      .returning();
    if (!row) throw new Error("Dish event was not recorded");
    const updated = (await listDishes(experimentId, tx)).find(
      (item) => item.id === dishId,
    );
    const event = updated?.events.find((item) => item.id === row.id);
    if (!event) throw new Error("Dish event was not read back");
    return event;
  });
}

export async function voidDishEvent(value: DishEventVoid): Promise<DishEvent> {
  const { experiment: experimentId, event: eventId, reason } = value;
  return transaction(async (tx) => {
    await lockExperiment(experimentId, tx);
    const [row] = await tx
      .update(experimentDishEvents)
      .set({ voidedAt: new Date(), voidReason: reason })
      .where(
        and(
          eq(experimentDishEvents.experimentId, experimentId),
          eq(experimentDishEvents.id, eventId),
          sql`${experimentDishEvents.voidedAt} is null`,
        ),
      )
      .returning({ dishId: experimentDishEvents.dishId });
    if (!row) {
      throw new DishEventNotFoundError(`Unknown active dish event: ${eventId}`);
    }
    const dish = (await listDishes(experimentId, tx)).find(
      (item) => item.id === row.dishId,
    );
    const event = dish?.events.find((item) => item.id === eventId);
    if (!event) throw new Error("Voided dish event was not read back");
    return event;
  });
}
