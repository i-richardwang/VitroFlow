import type {
  CultureEvent,
  CultureEventType,
  ExperimentObservation,
} from "./schema";

type ObservationOrdinals = ReadonlyMap<string, number>;

export const CULTURE_EVENT_LABELS: Record<CultureEventType, string> = {
  contaminated: "Contaminated",
  nonviable: "Nonviable",
  discarded: "Discarded",
  harvested: "Harvested",
  missing: "Missing",
};

function eventOrdinal(
  event: CultureEvent,
  ordinals: ObservationOrdinals,
): number {
  const ordinal = ordinals.get(event.observation);
  if (ordinal === undefined) {
    throw new Error(
      `Unknown observation for culture event: ${event.observation}`,
    );
  }
  return ordinal;
}

/** A removal takes effect after the observation that records it. */
export function observationUnitIsAvailableAt(
  events: readonly CultureEvent[],
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
 * also removes the observation unit from every later analysis denominator.
 */
export function observationUnitIsIncludedInAnalysis(
  events: readonly CultureEvent[],
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
export function latestActiveCultureEvent(
  events: readonly CultureEvent[],
  ordinals: ObservationOrdinals,
): CultureEvent | null {
  return events.reduce<CultureEvent | null>((latest, event) => {
    if (event.voidedAt !== null) return latest;
    if (!latest) return event;
    const byObservation =
      eventOrdinal(event, ordinals) - eventOrdinal(latest, ordinals);
    if (byObservation !== 0) return byObservation > 0 ? event : latest;
    return event.recordedAt > latest.recordedAt ? event : latest;
  }, null);
}
