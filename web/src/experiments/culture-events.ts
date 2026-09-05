import type {
  CultureEvent,
  CultureEventType,
  ExperimentObservation,
} from "./schema";

type ObservationOrdinals = ReadonlyMap<string, number>;

/**
 * What an event means for the unit: whether it leaves the bench, and whether
 * its readings leave the analysis.
 */
interface CultureEventKind {
  label: string;
  terminal: boolean;
  excludesFromAnalysis: boolean;
}

const CULTURE_EVENT_KINDS: Record<CultureEventType, CultureEventKind> = {
  contaminated: {
    label: "Contaminated",
    terminal: false,
    excludesFromAnalysis: true,
  },
  nonviable: {
    label: "Nonviable",
    terminal: false,
    excludesFromAnalysis: false,
  },
  discarded: {
    label: "Discarded",
    terminal: true,
    excludesFromAnalysis: true,
  },
  harvested: {
    label: "Harvested",
    terminal: true,
    excludesFromAnalysis: false,
  },
  missing: {
    label: "Missing",
    terminal: true,
    excludesFromAnalysis: true,
  },
};

export function cultureEventLabel(type: CultureEventType): string {
  return CULTURE_EVENT_KINDS[type].label;
}

export function cultureEventIsTerminal(type: CultureEventType): boolean {
  return CULTURE_EVENT_KINDS[type].terminal;
}

export function cultureEventExcludesFromAnalysis(
  type: CultureEventType,
): boolean {
  return CULTURE_EVENT_KINDS[type].excludesFromAnalysis;
}

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

/** A terminal event takes effect after the observation that records it. */
export function observationUnitIsAvailableAt(
  events: readonly CultureEvent[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): boolean {
  return !events.some(
    (event) =>
      cultureEventIsTerminal(event.type) &&
      eventOrdinal(event, ordinals) < observation.ordinal,
  );
}

/**
 * An exclusion starts in its recorded observation. Leaving the bench also
 * takes the unit out of every later analysis denominator.
 */
export function observationUnitIsIncludedInAnalysis(
  events: readonly CultureEvent[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): boolean {
  return !events.some((event) => {
    const ordinal = eventOrdinal(event, ordinals);
    return (
      (cultureEventExcludesFromAnalysis(event.type) &&
        ordinal <= observation.ordinal) ||
      (cultureEventIsTerminal(event.type) && ordinal < observation.ordinal)
    );
  });
}

/** The latest biological event, regardless of when it was entered. */
export function latestCultureEvent(
  events: readonly CultureEvent[],
  ordinals: ObservationOrdinals,
): CultureEvent | null {
  return events.reduce<CultureEvent | null>((latest, event) => {
    if (!latest) return event;
    const byObservation =
      eventOrdinal(event, ordinals) - eventOrdinal(latest, ordinals);
    if (byObservation !== 0) return byObservation > 0 ? event : latest;
    return event.recordedAt > latest.recordedAt ? event : latest;
  }, null);
}
