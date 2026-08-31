import type { DishEvent, DishEventType, ExperimentObservation } from "./schema";

type ObservationOrdinals = ReadonlyMap<string, number>;

export const DISH_EVENT_LABELS: Record<DishEventType, string> = {
  contaminated: "Contaminated",
  dead: "Dead",
  discarded: "Discarded",
  harvested: "Harvested",
  lost: "Lost",
};

function eventOrdinal(event: DishEvent, ordinals: ObservationOrdinals): number {
  const ordinal = ordinals.get(event.observation);
  if (ordinal === undefined) {
    throw new Error(`Unknown observation for dish event: ${event.observation}`);
  }
  return ordinal;
}

/** A removal takes effect after the observation that records it. */
export function dishIsAvailableAt(
  events: readonly DishEvent[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): boolean {
  return !events.some(
    (event) =>
      event.voidedAt === null &&
      event.removeAfterObservation &&
      eventOrdinal(event, ordinals) < observation.ordinal,
  );
}

/**
 * An explicit exclusion starts in its recorded observation. Physical removal
 * also removes the dish from every later analysis denominator.
 */
export function dishIsIncludedInAnalysis(
  events: readonly DishEvent[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): boolean {
  return !events.some((event) => {
    if (event.voidedAt !== null) return false;
    const ordinal = eventOrdinal(event, ordinals);
    return (
      (event.excludeFromObservation && ordinal <= observation.ordinal) ||
      (event.removeAfterObservation && ordinal < observation.ordinal)
    );
  });
}

/** The latest biological event, regardless of when it was entered. */
export function latestActiveDishEvent(
  events: readonly DishEvent[],
  ordinals: ObservationOrdinals,
): DishEvent | null {
  return events.reduce<DishEvent | null>((latest, event) => {
    if (event.voidedAt !== null) return latest;
    if (!latest) return event;
    const byObservation =
      eventOrdinal(event, ordinals) - eventOrdinal(latest, ordinals);
    if (byObservation !== 0) return byObservation > 0 ? event : latest;
    return event.recordedAt > latest.recordedAt ? event : latest;
  }, null);
}
