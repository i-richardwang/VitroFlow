import type { Dataset } from "../datasets/schema";
import type { TrainingRun } from "../training/schema";
import type { TrainingSummary } from "../training/read-model";
import { readDatasetSnapshot } from "./dataset-snapshots";
import type { ImageRecord } from "./summaries";
import {
  activeTrainingRun,
  countTrainingRuns,
  latestTrainingRun,
} from "./training-runs";
import {
  listTrainingWorkers,
  trainingWorkerPresence,
} from "./training-worker-store";

/** Where one dataset and its model stand before another training run. */
async function reviewedSinceLastRun(
  records: ImageRecord[],
  latest: TrainingRun | undefined,
): Promise<number> {
  const snapshot = latest
    ? await readDatasetSnapshot(latest.datasetSnapshotId)
    : null;
  const captured = new Set(
    snapshot?.images.map(
      (image) => `${image.digest}#${image.annotation.revision}`,
    ) ?? [],
  );
  return records.filter(
    ({ image, annotation }) =>
      annotation?.status === "complete" &&
      !captured.has(`${image.digest}#${annotation.revision}`),
  ).length;
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
  const [workers, active, runs, latest] = await Promise.all([
    listTrainingWorkers(at),
    activeTrainingRun(dataset.modelId),
    countTrainingRuns(dataset.id),
    latestTrainingRun(dataset.id),
  ]);
  const online = workers.filter(
    (worker) => trainingWorkerPresence(worker, at) === "online",
  );
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
