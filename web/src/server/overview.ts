import type { Dataset, ImageState } from "../datasets/schema";
import type { ModelArtifact, ModelVersion } from "../models/schema";
import type { TrainingRun } from "../training/schema";
import { readDatasetSnapshot, snapshotImageCounts } from "./dataset-snapshots";
import { readDataset } from "./datasets";
import {
  canExecute,
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
  /** Reviewed images the version was trained on; none for builtin versions. */
  trainingImages: number | null;
}

/** Where the model's training stands, without the runs themselves. */
export interface TrainingSummary {
  runs: number;
  active: TrainingRun | null;
  /** Complete annotations the most recent run's snapshot does not contain. */
  reviewedSinceLastRun: number;
  workersOnline: number;
}

/** Everything the dataset page shows: images, candidate versions, and training. */
export interface DatasetOverview {
  dataset: Dataset;
  images: ImageSummary[];
  counts: Record<ImageState, number>;
  versions: VersionOverview[];
  /** Inference workers able to execute the selected version, by presence. */
  inference: WorkerCount;
  training: TrainingSummary;
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

async function inferenceWorkerCount(
  artifact: ModelArtifact,
  at: Date,
): Promise<WorkerCount> {
  const count = { online: 0, stale: 0 };
  for (const worker of await listInferenceWorkers(at)) {
    const presence = inferenceWorkerPresence(worker, at);
    if (presence === "offline" || !canExecute(worker, artifact)) continue;
    count[presence] += 1;
  }
  return count;
}

export async function trainingSummary(
  modelId: string,
  records: ImageRecord[],
  runs: TrainingRun[],
  at: Date,
): Promise<TrainingSummary> {
  const workers = await listTrainingWorkers(at);
  return {
    runs: runs.length,
    active: await activeTrainingRun(modelId),
    reviewedSinceLastRun: await reviewedSinceLastRun(records, runs[0]),
    workersOnline: workers.filter(
      (worker) => trainingWorkerPresence(worker, at) === "online",
    ).length,
  };
}

export async function datasetOverview(
  datasetId: string,
  at: Date = new Date(),
): Promise<DatasetOverview | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const records = await listImageRecords(datasetId);
  const summaries = records.map(summarize);
  const [modelVersions, runs] = await Promise.all([
    listModelVersions(dataset.modelId),
    listTrainingRuns(dataset.modelId),
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
    trainingImages:
      version.source.kind === "training_run"
        ? (trainingImages.get(version.source.datasetSnapshotId) ?? null)
        : null,
  }));
  const selected = versions.find((entry) => entry.selected);
  return {
    dataset,
    images: summaries,
    counts: countImageStates(summaries),
    versions,
    inference: selected
      ? await inferenceWorkerCount(selected.version.artifact, at)
      : { online: 0, stale: 0 },
    training: await trainingSummary(dataset.modelId, records, runs, at),
  };
}
