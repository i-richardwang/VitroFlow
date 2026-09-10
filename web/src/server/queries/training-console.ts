import type {
  TrainingConsole,
  TrainingOverview,
  TrainingRunDetail,
  VersionOverview,
} from "../../domain/training/read-model";
import { YOLO26_SEED_SMALL_RECIPE } from "../../domain/training/recipes";
import {
  readDatasetSnapshot,
  snapshotImageCounts,
  countActiveTrainingRuns,
  countTrainingRuns,
  listTrainingEpochs,
  listTrainingRunSummaries,
  readTrainingRun,
} from "../training/public";
import {
  readDataset,
  countReviewed,
  listImageRecords,
} from "../datasets/public";
import { listAllModelVersions, readModelVersion } from "../models/public";

import { trainingSummary } from "./training-summary";
import { listOnlineTrainers } from "../workers/public";

async function listVersionOverviews(): Promise<VersionOverview[]> {
  const versions = await listAllModelVersions();
  const trainingImages = await snapshotImageCounts(
    versions.flatMap((version) =>
      version.source.kind === "training_run"
        ? [version.source.datasetSnapshotId]
        : [],
    ),
  );
  return versions.map((version) => ({
    version,
    trainingImages:
      version.source.kind === "training_run"
        ? (trainingImages.get(version.source.datasetSnapshotId) ?? null)
        : null,
  }));
}

export async function trainingOverview(
  at: Date = new Date(),
): Promise<TrainingOverview> {
  const [versions, runs, total, inProgress, trainers] = await Promise.all([
    listVersionOverviews(),
    listTrainingRunSummaries(),
    countTrainingRuns(),
    countActiveTrainingRuns(),
    listOnlineTrainers(at),
  ]);
  return {
    versions,
    total,
    runs,
    inProgress,
    workersOnline: trainers.length,
  };
}

/** Everything the training page shows for one dataset. */
export async function trainingConsole(
  datasetId: string,
  at: Date = new Date(),
): Promise<TrainingConsole | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const records = await listImageRecords(datasetId);
  const runs = await listTrainingRunSummaries({ datasetId: dataset.id });
  return {
    dataset: dataset.id,
    reviewed: countReviewed(records),
    recipe: YOLO26_SEED_SMALL_RECIPE,
    training: await trainingSummary(dataset, records, at),
    runs,
  };
}

/** One run with its whole epoch history and the version it published. */
export async function trainingRunDetail(
  datasetId: string,
  runId: string,
): Promise<TrainingRunDetail | null> {
  const dataset = await readDataset(datasetId);
  const run = await readTrainingRun(runId);
  if (!dataset || !run) return null;
  const snapshot = await readDatasetSnapshot(run.datasetSnapshotId);
  if (snapshot?.datasetId !== dataset.id) return null;
  return {
    dataset: dataset.id,
    run,
    epochs: await listTrainingEpochs(runId),
    version:
      run.state.status === "succeeded"
        ? await readModelVersion(run.state.modelVersionId)
        : null,
  };
}
