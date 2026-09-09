import type { AnnotationDocument } from "../../annotation/schema";
import type { Dataset } from "../../datasets/schema";
import type { TrainingRun } from "../../training/schema";
import type { TrainingSummary } from "../../training/read-model";
import {
  readDatasetSnapshot,
  activeTrainingRun,
  countTrainingRuns,
  latestTrainingRun,
} from "../training/public";
import type { ImageRecord } from "../datasets/public";

import { listOnlineTrainers } from "../workers/public";

/**
 * Reviews the last run did not train on: images reviewed since, and images
 * whose review has changed since the snapshot froze it.
 */
async function reviewedSinceLastRun(
  records: ImageRecord[],
  latest: TrainingRun | undefined,
): Promise<number> {
  const snapshot = latest
    ? await readDatasetSnapshot(latest.datasetSnapshotId)
    : null;
  const trained = new Map(
    snapshot?.images.map((image) => [image.digest, boxes(image.annotation)]) ??
      [],
  );
  return records.filter(
    ({ image, annotation }) =>
      annotation !== null && trained.get(image.digest) !== boxes(annotation),
  ).length;
}

/** The boxes of a review in a form two reviews can be compared by. */
function boxes(annotation: AnnotationDocument): string {
  return JSON.stringify(
    annotation.instances.map(({ id, class: className, bbox }) => [
      id,
      className,
      bbox.x,
      bbox.y,
      bbox.width,
      bbox.height,
    ]),
  );
}

/**
 * Runs and readiness are the dataset's own; the active run is the model's,
 * because one run at a time trains a model whichever dataset feeds it.
 */
export async function trainingSummary(
  dataset: Dataset,
  records: ImageRecord[],
  at: Date,
): Promise<TrainingSummary> {
  const [online, active, runs, latest] = await Promise.all([
    listOnlineTrainers(at),
    activeTrainingRun(dataset.modelId),
    countTrainingRuns(dataset.id),
    latestTrainingRun(dataset.id),
  ]);
  return {
    runs,
    active,
    reviewedSinceLastRun: await reviewedSinceLastRun(
      records,
      latest ?? undefined,
    ),
    workersOnline: online.length,
    workerMemoryBytes: online.length
      ? Math.min(...online.map((worker) => worker.memoryBytes))
      : null,
  };
}
