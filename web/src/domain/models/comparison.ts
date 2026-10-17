import { classCount, type Tally } from "./classes";

/**
 * What one version read for a held-out image: its tally, `failed` when the
 * version could not read it, or null while it has not yet.
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
  /** Null when the model has no current version. */
  current: ComparedReading;
}

/** How closely one version's counts match the reviewer's over the scored images. */
export interface CountAccuracy {
  /** Mean absolute count error per image, for each class of the model. */
  meanError: Record<string, number>;
  /** Images on which every class was counted exactly. */
  exact: number;
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

function progress(readings: ComparedReading[]): ReadProgress {
  return {
    read: readings.filter((reading) => reading !== null && reading !== "failed")
      .length,
    failed: readings.filter((reading) => reading === "failed").length,
  };
}

function isTally(reading: ComparedReading): reading is Tally {
  return reading !== null && reading !== "failed";
}

/** How far a reading is from the reviewer's count, summed over the classes. */
export function countError(
  classes: readonly string[],
  reviewed: Tally,
  reading: Tally,
): number {
  return classes.reduce(
    (sum, name) =>
      sum + Math.abs(classCount(reading, name) - classCount(reviewed, name)),
    0,
  );
}

function accuracy(
  classes: readonly string[],
  pairs: { reviewed: Tally; reading: Tally }[],
): CountAccuracy {
  const meanError: Record<string, number> = {};
  for (const name of classes) {
    const total = pairs.reduce(
      (sum, { reviewed, reading }) =>
        sum + Math.abs(classCount(reading, name) - classCount(reviewed, name)),
      0,
    );
    meanError[name] = total / pairs.length;
  }
  return {
    meanError,
    exact: pairs.filter(
      ({ reviewed, reading }) => countError(classes, reviewed, reading) === 0,
    ).length,
  };
}

export function compareVersions(
  classes: readonly string[],
  currentVersionId: string | null,
  images: readonly ComparedImage[],
): VersionComparison {
  const scored = images.filter(
    (image) =>
      isTally(image.candidate) &&
      (currentVersionId === null || isTally(image.current)),
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
              scored.map((image) => ({
                reviewed: image.reviewed,
                reading: image.candidate as Tally,
              })),
            ),
            current:
              currentVersionId === null
                ? null
                : accuracy(
                    classes,
                    scored.map((image) => ({
                      reviewed: image.reviewed,
                      reading: image.current as Tally,
                    })),
                  ),
          },
  };
}
