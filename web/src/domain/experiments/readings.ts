import type { ReviewSource } from "../annotation/review";
import { count, type Tally } from "../models/classes";
import type { ObservationImageCell, Unit } from "./contracts";
import { exclusionAt, type ObservationOrdinals } from "./culture-events";
import type { ExperimentObservation } from "./schema";

/**
 * What a unit read on a day: the individuals found, their share of the
 * population the unit started with, and who stood behind the number.
 */
export interface Reading {
  count: number;
  rate: number | null;
  /** The best reading the image has: a reviewer's, an agent's, or the detector's. */
  source: ReviewSource;
  /** The detection the reading replaced, when it came from elsewhere. */
  detected: number | null;
}

/** A cell of the grid is one unit on one observation. */
export function cellKey(unit: string, observation: string): string {
  return `${unit}:${observation}`;
}

/**
 * The tally a cell reads by, and whose it is. A reviewer's annotation
 * outranks an agent's proposal, which outranks the detection; an image still
 * waiting or failed reads by nothing.
 */
export function cellReading(
  image: ObservationImageCell | undefined,
): { tally: Tally; source: ReviewSource } | null {
  if (!image) return null;
  if (image.annotationTally) {
    return { tally: image.annotationTally, source: "review" };
  }
  if (image.proposalTally) {
    return { tally: image.proposalTally, source: "proposal" };
  }
  if (image.detectionTally) {
    return { tally: image.detectionTally, source: "detection" };
  }
  return null;
}

export function cellTally(
  image: ObservationImageCell | undefined,
): Tally | null {
  return cellReading(image)?.tally ?? null;
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

/**
 * The share of the unit's starting population this count represents. A unit
 * whose baseline was never counted has no share, and neither has one whose
 * baseline found nothing.
 */
function share(found: number, population: number | null): number | null {
  if (population === null || population === 0) return null;
  return found / population;
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
      const image = cells.get(cellKey(unit, observation.id));
      const reading = cellReading(image);
      if (!image || !reading) return null;
      const replaced =
        reading.source === "detection" ? null : image.detectionTally;
      const started = observation.id === baseline?.id ? null : population(unit);
      const found = count(reading.tally);
      return {
        count: found,
        rate: share(found, started),
        source: reading.source,
        detected: replaced === null ? null : count(replaced),
      };
    },
  };
}

/**
 * A quantity over the replicates of one treatment: the typical value and its
 * spread. Units without a value are absent. The spread is the sample standard
 * deviation, which a single replicate does not have.
 */
export interface Summary {
  value: number | null;
  deviation: number | null;
  sampleSize: number;
}

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) {
    return { value: null, deviation: null, sampleSize: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation =
    values.length < 2
      ? null
      : Math.sqrt(
          values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
            (values.length - 1),
        );
  return { value: mean, deviation, sampleSize: values.length };
}

/** What a treatment read on one day: its replicates' counts, and their shares. */
export interface TreatmentSummary {
  count: Summary;
  rate: Summary | null;
}

/**
 * A treatment on one day, over the replicates the analysis still counts, a
 * population that exclusions move day by day. Shares average only when every
 * one of those replicates has one, since a mean over some of them would divide
 * by a population it never states.
 */
export function treatmentSummary(
  readings: ExperimentReadings,
  replicates: readonly Unit[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): TreatmentSummary {
  const counted = replicates.flatMap((unit) => {
    if (exclusionAt(unit.events, observation, ordinals)) return [];
    const reading = readings.read(unit.id, observation);
    return reading ? [reading] : [];
  });
  const shares = counted.flatMap((reading) =>
    reading.rate === null ? [] : [reading.rate],
  );
  return {
    count: summarize(counted.map((reading) => reading.count)),
    rate:
      counted.length > 0 && shares.length === counted.length
        ? summarize(shares)
        : null,
  };
}
