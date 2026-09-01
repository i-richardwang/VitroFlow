import type {
  CultureEvent,
  CultureEventType,
  ExperimentObservation,
} from "./schema";

type ObservationOrdinals = ReadonlyMap<string, number>;

interface CultureEventKind {
  label: string;
  terminal: boolean;
  excludesFromAnalysisByDefault: boolean;
}

const CULTURE_EVENT_KINDS: Record<CultureEventType, CultureEventKind> = {
  contaminated: {
    label: "Contaminated",
    terminal: false,
    excludesFromAnalysisByDefault: true,
  },
  nonviable: {
    label: "Nonviable",
    terminal: false,
    excludesFromAnalysisByDefault: false,
  },
  discarded: {
    label: "Discarded",
    terminal: true,
    excludesFromAnalysisByDefault: true,
  },
  harvested: {
    label: "Harvested",
    terminal: true,
    excludesFromAnalysisByDefault: false,
  },
  missing: {
    label: "Missing",
    terminal: true,
    excludesFromAnalysisByDefault: true,
  },
};

export function cultureEventLabel(type: CultureEventType): string {
  return CULTURE_EVENT_KINDS[type].label;
}

export function cultureEventIsTerminal(type: CultureEventType): boolean {
  return CULTURE_EVENT_KINDS[type].terminal;
}

export function cultureEventExcludesFromAnalysisByDefault(
  type: CultureEventType,
): boolean {
  return CULTURE_EVENT_KINDS[type].excludesFromAnalysisByDefault;
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

function activeEvents(events: readonly CultureEvent[]): CultureEvent[] {
  return events.filter((event) => event.voidedAt === null);
}

/** A terminal event takes effect after the observation that records it. */
export function observationUnitIsAvailableAt(
  events: readonly CultureEvent[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): boolean {
  return !activeEvents(events).some(
    (event) =>
      cultureEventIsTerminal(event.type) &&
      eventOrdinal(event, ordinals) < observation.ordinal,
  );
}

/**
 * An explicit exclusion starts in its recorded observation. Leaving the bench
 * also takes the unit out of every later analysis denominator.
 */
export function observationUnitIsIncludedInAnalysis(
  events: readonly CultureEvent[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): boolean {
  return !activeEvents(events).some((event) => {
    const ordinal = eventOrdinal(event, ordinals);
    return (
      (event.excludeFromObservation && ordinal <= observation.ordinal) ||
      (cultureEventIsTerminal(event.type) && ordinal < observation.ordinal)
    );
  });
}

/** The latest biological event, regardless of when it was entered. */
export function latestActiveCultureEvent(
  events: readonly CultureEvent[],
  ordinals: ObservationOrdinals,
): CultureEvent | null {
  return activeEvents(events).reduce<CultureEvent | null>((latest, event) => {
    if (!latest) return event;
    const byObservation =
      eventOrdinal(event, ordinals) - eventOrdinal(latest, ordinals);
    if (byObservation !== 0) return byObservation > 0 ? event : latest;
    return event.recordedAt > latest.recordedAt ? event : latest;
  }, null);
}
