import type { Dataset, ImageState } from "../datasets/schema";
import type { ModelVersion } from "../models/schema";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import type { TrainingRecipe, TrainingRun } from "../training/schema";
import { readDatasetSnapshot, snapshotImageCounts } from "./dataset-snapshots";
import { readDataset } from "./datasets";
import {
  inferenceWorkerPresence,
  listInferenceWorkers,
} from "./inference-worker-store";
import { listModelVersions } from "./model-registry";
import {
  countImageStates,
  listImageRecords,
  summarize,
  type ImageRecord,
  type ImageSummary,
} from "./summaries";
import { activeTrainingRun, listTrainingRuns } from "./training-runs";
import {
  listTrainingWorkers,
  trainingWorkerPresence,
} from "./training-worker-store";

export interface WorkerCount {
  online: number;
  /** Heartbeats overdue but not yet forgotten; the worker may be mid-image. */
  stale: number;
}

export interface VersionOverview {
  version: ModelVersion;
  selected: boolean;
  /** Inference workers deployed with this exact version, by presence. */
  serving: WorkerCount;
  /** Reviewed images the version was trained on; none for builtin versions. */
  trainingImages: number | null;
}

export interface TrainingOverview {
  /** Runs for the dataset's model, newest first. */
  runs: TrainingRun[];
  active: TrainingRun | null;
  /** Complete annotations the most recent run's snapshot does not contain. */
  reviewedSinceLastRun: number;
  workersOnline: number;
  recipe: TrainingRecipe;
}

/** Everything the dataset page shows: images, candidate versions, and training. */
export interface DatasetOverview {
  dataset: Dataset;
  images: ImageSummary[];
  counts: Record<ImageState, number>;
  versions: VersionOverview[];
  training: TrainingOverview;
}

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
    ({ image, label }) =>
      label?.status === "complete" &&
      !captured.has(`${image.digest}#${label.revision}`),
  ).length;
}

async function servingWorkerCounts(
  at: Date,
): Promise<Map<string, WorkerCount>> {
  const counts = new Map<string, WorkerCount>();
  for (const worker of await listInferenceWorkers(at)) {
    const presence = inferenceWorkerPresence(worker, at);
    if (presence === "offline") continue;
    const versionId = worker.deployment.modelVersionId;
    const count = counts.get(versionId) ?? { online: 0, stale: 0 };
    count[presence] += 1;
    counts.set(versionId, count);
  }
  return counts;
}

export async function datasetOverview(
  datasetId: string,
  at: Date = new Date(),
): Promise<DatasetOverview | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const records = await listImageRecords(datasetId);
  const summaries = records.map(summarize);
  const [serving, modelVersions, runs, trainingWorkers] = await Promise.all([
    servingWorkerCounts(at),
    listModelVersions(dataset.modelId),
    listTrainingRuns(dataset.modelId),
    listTrainingWorkers(at),
  ]);
  const trainingImages = await snapshotImageCounts(
    modelVersions.flatMap((version) =>
      version.source.kind === "training_run"
        ? [version.source.datasetSnapshotId]
        : [],
    ),
  );
  const versions = modelVersions.map((version) => ({
    version,
    selected: version.id === dataset.selectedModelVersionId,
    serving: serving.get(version.id) ?? { online: 0, stale: 0 },
    trainingImages:
      version.source.kind === "training_run"
        ? (trainingImages.get(version.source.datasetSnapshotId) ?? null)
        : null,
  }));
  return {
    dataset,
    images: summaries,
    counts: countImageStates(summaries),
    versions,
    training: {
      runs,
      active: await activeTrainingRun(dataset.modelId),
      reviewedSinceLastRun: await reviewedSinceLastRun(records, runs[0]),
      workersOnline: trainingWorkers.filter(
        (worker) => trainingWorkerPresence(worker, at) === "online",
      ).length,
      recipe: YOLO26_SEED_SMALL_RECIPE,
    },
  };
}
