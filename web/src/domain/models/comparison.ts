import { classCount, type Tally } from "./classes";

/**
 * What one version read for a held-out image: its tally, `failed` when the
 * version could not read it, or null while it has not.
 */
export type ComparedReading = Tally | "failed" | null;

/**
 * One validation image of a candidate's training snapshot: what the reviewer
 * counted when the snapshot froze it, and what each version reads.
 */
export interface ComparedImage {
  digest: string;
  /** The dataset the snapshot froze it from, while the image is still in it. */
  dataset: { id: string; filename: string } | null;
  reviewed: Tally;
  candidate: ComparedReading;
  /** Always null when the model has no current version. */
  current: ComparedReading;
}

/** How closely one version's counts match the reviewer's over the scored images. */
export interface CountAccuracy {
  /** Mean absolute count error per image, for each class of the model. */
  meanError: Record<string, number>;
}

export interface ReadProgress {
  read: number;
  failed: number;
}

/**
 * A candidate set against the current version on the validation images the
 * candidate never trained on. Accuracy is scored only over the images both
 * have read, so the two numbers are always about the same images.
 */
export interface VersionComparison {
  /** The current version it is compared against, or null when there is none. */
  currentVersionId: string | null;
  heldOut: number;
  candidate: ReadProgress;
  current: ReadProgress | null;
  scored: number;
  accuracy: {
    candidate: CountAccuracy;
    current: CountAccuracy | null;
  } | null;
}

/** The comparison together with the images it was made on. */
export interface VersionComparisonDetail extends VersionComparison {
  images: ComparedImage[];
}

/** Whether either version has held-out images still to read. */
export function isReading(comparison: VersionComparison): boolean {
  const { heldOut, candidate, current } = comparison;
  const done = ({ read, failed }: ReadProgress) => read + failed >= heldOut;
  return !done(candidate) || (current !== null && !done(current));
}

export function isCounted(reading: ComparedReading): reading is Tally {
  return reading !== null && reading !== "failed";
}

function classError(reviewed: Tally, reading: Tally, name: string): number {
  return Math.abs(classCount(reading, name) - classCount(reviewed, name));
}

/** How far a reading is from the reviewer's count, summed over the classes. */
export function countError(
  classes: readonly string[],
  reviewed: Tally,
  reading: Tally,
): number {
  return classes.reduce(
    (sum, name) => sum + classError(reviewed, reading, name),
    0,
  );
}

function progress(readings: ComparedReading[]): ReadProgress {
  return {
    read: readings.filter(isCounted).length,
    failed: readings.filter((reading) => reading === "failed").length,
  };
}

function accuracy(
  classes: readonly string[],
  pairs: { reviewed: Tally; reading: Tally }[],
): CountAccuracy {
  return {
    meanError: Object.fromEntries(
      classes.map((name) => [
        name,
        pairs.reduce(
          (sum, { reviewed, reading }) =>
            sum + classError(reviewed, reading, name),
          0,
        ) / pairs.length,
      ]),
    ),
  };
}

export function compareVersions(
  classes: readonly string[],
  currentVersionId: string | null,
  images: ComparedImage[],
): VersionComparisonDetail {
  const scored = images.flatMap(({ reviewed, candidate, current }) =>
    isCounted(candidate) && (currentVersionId === null || isCounted(current))
      ? [{ reviewed, candidate, current: isCounted(current) ? current : null }]
      : [],
  );
  return {
    currentVersionId,
    heldOut: images.length,
    candidate: progress(images.map((image) => image.candidate)),
    current:
      currentVersionId === null
        ? null
        : progress(images.map((image) => image.current)),
    scored: scored.length,
    accuracy:
      scored.length === 0
        ? null
        : {
            candidate: accuracy(
              classes,
              scored.map(({ reviewed, candidate }) => ({
                reviewed,
                reading: candidate,
              })),
            ),
            current:
              currentVersionId === null
                ? null
                : accuracy(
                    classes,
                    scored.flatMap(({ reviewed, current }) =>
                      current ? [{ reviewed, reading: current }] : [],
                    ),
                  ),
          },
    images,
  };
}
