import type { ReviewSource } from "../annotation/schema";
import { count, type Tally } from "../models/classes";
import type {
  ExperimentGrid,
  ImageReview,
  ObservationImageCell,
  ReplicateSummary,
  TrendDay,
  Unit,
} from "./contracts";
import {
  exclusionAt,
  observationOrdinals,
  type ObservationOrdinals,
} from "./culture-events";
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

/** A photograph is reviewed once a person has stored its boxes. */
export function imageReview(image: ObservationImageCell): ImageReview {
  return image.annotationTally ? "reviewed" : "unreviewed";
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

export function summarize(values: readonly number[]): ReplicateSummary {
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
): ReplicateSummary {
  return summarize(
    replicates.flatMap((unit) => {
      if (exclusionAt(unit.events, observation, ordinals)) return [];
      const reading = unitReading(cells, unit.id, observation);
      return reading ? [reading.count] : [];
    }),
  );
}

/**
 * How the treatments compare over time: every day with a reading that reads
 * for the same model as the newest such day, since days that read for
 * different models answer different questions. Empty until a day reads.
 */
export function treatmentTrend(
  grid: Pick<
    ExperimentGrid,
    "treatments" | "units" | "observations" | "images"
  >,
): TrendDay[] {
  const cells = observationCells(grid.images);
  const ordinals = observationOrdinals(grid.observations);
  const days = grid.observations.map((observation) => ({
    observation,
    treatments: grid.treatments.map((treatment) => ({
      treatment: treatment.id,
      summary: treatmentSummary(
        cells,
        grid.units.filter((unit) => unit.treatment === treatment.id),
        observation,
        ordinals,
      ),
    })),
  }));
  const read = days.filter((day) =>
    day.treatments.some(({ summary }) => summary.value !== null),
  );
  const newest = read.at(-1);
  if (!newest) return [];
  return read.filter(
    (day) => day.observation.modelId === newest.observation.modelId,
  );
}
