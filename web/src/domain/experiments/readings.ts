import { count, rate, type Tally } from "../models/readings";
import type { ObservationImageCell } from "./contracts";
import type { ExperimentObservation } from "./schema";

/**
 * What a unit read on a day: the individuals found, and their share of the
 * population the unit started with.
 */
export interface Reading {
  count: number;
  rate: number | null;
}

/** A cell of the grid is one unit on one observation. */
export function cellKey(unit: string, observation: string): string {
  return `${unit}:${observation}`;
}

/**
 * The tally a cell reads by. A calibrated annotation replaces the detection it
 * was drawn over; an image still waiting, failed, or unreviewed reads by its
 * detection alone.
 */
export function cellTally(
  image: ObservationImageCell | undefined,
): Tally | null {
  if (!image) return null;
  return image.annotationTally ?? image.detectionTally;
}

/**
 * The observation a unit's population is counted from. Dishes are sown without
 * counting, so the earliest photograph of one establishes how many individuals
 * it holds, and every later share divides by that.
 */
export function baselineObservation(
  observations: readonly ExperimentObservation[],
): ExperimentObservation | undefined {
  return observations.reduce<ExperimentObservation | undefined>(
    (earliest, observation) =>
      !earliest || observation.ordinal < earliest.ordinal
        ? observation
        : earliest,
    undefined,
  );
}

export interface ExperimentReadings {
  baseline: ExperimentObservation | undefined;
  /** How many individuals the unit started with, or nothing when never counted. */
  population: (unit: string) => number | null;
  read: (unit: string, observation: ExperimentObservation) => Reading | null;
}

/**
 * The numbers an experiment's grid reads. The share a unit shows on its own
 * baseline is one by construction, so the baseline reads counts alone.
 */
export function experimentReadings(
  observations: readonly ExperimentObservation[],
  cells: ReadonlyMap<string, ObservationImageCell>,
): ExperimentReadings {
  const baseline = baselineObservation(observations);
  const population = (unit: string): number | null => {
    if (!baseline) return null;
    const counts = cellTally(cells.get(cellKey(unit, baseline.id)));
    return counts === null ? null : count(counts);
  };
  return {
    baseline,
    population,
    read: (unit, observation) => {
      const counts = cellTally(cells.get(cellKey(unit, observation.id)));
      if (counts === null) return null;
      const found = count(counts);
      const started = observation.id === baseline?.id ? null : population(unit);
      return { count: found, rate: rate(found, started) };
    },
  };
}
