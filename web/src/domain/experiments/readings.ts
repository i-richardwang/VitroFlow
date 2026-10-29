import type { ReviewSource } from "../annotation/schema";
import { countClasses, sameClasses, type Tally } from "../models/classes";
import { UnknownClassError } from "../models/errors";
import type { ImageReview, ObservationImageCell } from "./contracts";
import type { Experiment, ExperimentObservation } from "./schema";

/** What a unit read on a day: the individuals found, and who stood behind the number. */
export interface Reading {
  count: number;
  source: ReviewSource;
}

/**
 * The classes a day counts, in the order its model declares them: every class
 * the model recognizes, unless the day names fewer of them.
 */
export function resolveCountedClasses(
  modelClasses: readonly string[],
  requested: readonly string[] | undefined,
): string[] {
  if (!requested) return [...modelClasses];
  const unknown = requested.filter((name) => !modelClasses.includes(name));
  if (unknown.length > 0) {
    throw new UnknownClassError(
      `The model does not recognize ${unknown.length === 1 ? "class" : "classes"}: ${unknown.join(", ")}`,
    );
  }
  return modelClasses.filter((name) => requested.includes(name));
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
  image: ObservationImageCell | null | undefined,
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

/**
 * What a day's photograph reads, counting the classes the day counts, or
 * nothing while there is no photograph or it has no reading.
 */
export function imageReading(
  image: ObservationImageCell | null | undefined,
  observation: Pick<ExperimentObservation, "countedClasses">,
): Reading | null {
  const reading = cellReading(image);
  return reading
    ? {
        count: countClasses(reading.tally, observation.countedClasses),
        source: reading.source,
      }
    : null;
}

/** What a unit read on a day, or nothing while its image has no reading. */
export function unitReading(
  cells: ObservationCells,
  unit: string,
  observation: ExperimentObservation,
): Reading | null {
  return imageReading(cells.get(cellKey(unit, observation.id)), observation);
}

/** A unit's day: the observation and the unit's photograph of it, if any. */
interface UnitDay {
  observation: Pick<ExperimentObservation, "modelId" | "countedClasses">;
  image: ObservationImageCell | null;
}

/** The experiment's rule for photographs marked unclear. */
type UnclearRule = Pick<Experiment, "countsUnclear">;

/**
 * Whether a photograph's number can be trusted. A clear photograph's can; an
 * unclear one's only where the experiment counts unclear photographs. One
 * not counted leaves its unit without a trusted number on that day, and only
 * that day: the number is still shown, but no spreadsheet or comparison
 * takes it, and the unit's other days read as they are.
 */
export function numberTrusted(
  image: Pick<ObservationImageCell, "unclear"> | null | undefined,
  rule: UnclearRule,
): boolean {
  return !image?.unclear || rule.countsUnclear;
}

/**
 * How much a unit's count rose from one day to another, or nothing unless
 * both days read and count alike: by one model, over the same classes, from
 * photographs whose numbers are trusted. Counts taken any other way measure
 * different things.
 */
export function countChange(
  from: UnitDay,
  to: UnitDay,
  rule: UnclearRule,
): number | null {
  const alike =
    from.observation.modelId === to.observation.modelId &&
    sameClasses(from.observation.countedClasses, to.observation.countedClasses);
  if (!alike) return null;
  if (!numberTrusted(from.image, rule) || !numberTrusted(to.image, rule)) {
    return null;
  }
  const before = imageReading(from.image, from.observation);
  const after = imageReading(to.image, to.observation);
  return before && after ? after.count - before.count : null;
}

/** Whether a unit's number of a day can be trusted under the experiment's rule. */
export function readingIsTrusted(
  cells: ObservationCells,
  unit: string,
  observation: ExperimentObservation,
  rule: UnclearRule,
): boolean {
  return numberTrusted(cells.get(cellKey(unit, observation.id)), rule);
}
