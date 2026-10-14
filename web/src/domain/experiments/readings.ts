import type { ReviewSource } from "../annotation/schema";
import { count, type Tally } from "../models/classes";
import type { ImageReview, ObservationImageCell } from "./contracts";
import type { ExperimentObservation } from "./schema";

/** What a unit read on a day: the individuals found, and who stood behind the number. */
export interface Reading {
  count: number;
  source: ReviewSource;
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

/** What a unit read on a day, or nothing while its image has no reading. */
export function unitReading(
  cells: ObservationCells,
  unit: string,
  observation: ExperimentObservation,
): Reading | null {
  const reading = cellReading(cells.get(cellKey(unit, observation.id)));
  return reading
    ? { count: count(reading.tally), source: reading.source }
    : null;
}
