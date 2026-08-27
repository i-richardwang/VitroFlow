import type { Dataset, ImageState } from "../datasets/schema";
import type { ModelVersion } from "../models/schema";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import type { TrainingRecipe, TrainingRun } from "../training/schema";
import { readDatasetSnapshot } from "./dataset-snapshots";
import { listImages, readDataset, type DatasetImage } from "./datasets";
import {
  inferenceWorkerPresence,
  listInferenceWorkers,
} from "./inference-worker-store";
import { readLabel } from "./labels";
import { listModelVersions } from "./model-registry";
import { countImageStates, summarizeImage, type ImageSummary } from "./summaries";
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

function reviewedSinceLastRun(
  images: DatasetImage[],
  latest: TrainingRun | undefined,
): number {
  const snapshot = latest ? readDatasetSnapshot(latest.datasetSnapshotId) : null;
  const captured = new Set(
    snapshot?.images.map(
      (image) => `${image.source}#${image.annotation.revision}`,
    ) ?? [],
  );
  return images.filter((image) => {
    const label = readLabel(image);
    return (
      label?.status === "complete" &&
      !captured.has(`${image.source}#${label.revision}`)
    );
  }).length;
}

function servingWorkerCounts(at: Date): Map<string, WorkerCount> {
  const counts = new Map<string, WorkerCount>();
  for (const worker of listInferenceWorkers(at)) {
    const presence = inferenceWorkerPresence(worker, at);
    if (presence === "offline") continue;
    const versionId = worker.deployment.modelVersionId;
    const count = counts.get(versionId) ?? { online: 0, stale: 0 };
    count[presence] += 1;
    counts.set(versionId, count);
  }
  return counts;
}

export function datasetOverview(
  datasetId: string,
  at: Date = new Date(),
): DatasetOverview | null {
  const dataset = readDataset(datasetId);
  if (!dataset) return null;
  const images = listImages(datasetId);
  const summaries = images.map(summarizeImage);
  const serving = servingWorkerCounts(at);
  const versions = listModelVersions(dataset.modelId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((version) => ({
      version,
      selected: version.id === dataset.selectedModelVersionId,
      serving: serving.get(version.id) ?? { online: 0, stale: 0 },
      trainingImages:
        version.source.kind === "training_run"
          ? (readDatasetSnapshot(version.source.datasetSnapshotId)?.images
              .length ?? null)
          : null,
    }));
  const runs = listTrainingRuns()
    .filter((run) => run.modelId === dataset.modelId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    dataset,
    images: summaries,
    counts: countImageStates(summaries),
    versions,
    training: {
      runs,
      active: activeTrainingRun(dataset.modelId),
      reviewedSinceLastRun: reviewedSinceLastRun(images, runs[0]),
      workersOnline: listTrainingWorkers(at).filter(
        (worker) => trainingWorkerPresence(worker, at) === "online",
      ).length,
      recipe: YOLO26_SEED_SMALL_RECIPE,
    },
  };
}
