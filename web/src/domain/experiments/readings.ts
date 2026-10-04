import type { ReviewSource } from "../annotation/schema";
import { count, type Tally } from "../models/classes";
import type { ObservationImageCell, Unit } from "./contracts";
import { exclusionAt, type ObservationOrdinals } from "./culture-events";
import type { ExperimentObservation } from "./schema";

/** What a unit read on a day: the individuals found, and who stood behind the number. */
export interface Reading {
  count: number;
  source: ReviewSource;
  detected: number | null;
}

export function cellKey(unit: string, observation: string): string {
  return `${unit}:${observation}`;
}

/** An experiment's images, each in the cell of its unit and observation. */
export type ObservationCells = ReadonlyMap<string, ObservationImageCell>;

export function observationCells(
  images: readonly ObservationImageCell[],
): ObservationCells {
  return new Map(
    images.map((image) => [cellKey(image.unit, image.observation), image]),
  );
}

/**
 * The tally a cell reads by, and whose it is. A reviewer's annotation
 * outranks an agent's proposal, which outranks the detection; an image still
 * waiting or failed reads by nothing.
 */
function cellReading(
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

/** What a unit read on a day, or nothing while its image has no reading. */
export function unitReading(
  cells: ObservationCells,
  unit: string,
  observation: ExperimentObservation,
): Reading | null {
  const image = cells.get(cellKey(unit, observation.id));
  const reading = cellReading(image);
  if (!image || !reading) return null;
  const replaced = reading.source === "detection" ? null : image.detectionTally;
  return {
    count: count(reading.tally),
    source: reading.source,
    detected: replaced === null ? null : count(replaced),
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

/**
 * A treatment's count on one day, over the replicates the analysis still
 * counts, a population that exclusions move day by day.
 */
export function treatmentSummary(
  cells: ObservationCells,
  replicates: readonly Unit[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): Summary {
  return summarize(
    replicates.flatMap((unit) => {
      if (exclusionAt(unit.events, observation, ordinals)) return [];
      const reading = unitReading(cells, unit.id, observation);
      return reading ? [reading.count] : [];
    }),
  );
}
