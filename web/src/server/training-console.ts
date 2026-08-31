import type {
  TrainingConsole,
  TrainingOverview,
  TrainingRunDetail,
  VersionOverview,
} from "../training/read-model";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { readDatasetSnapshot, snapshotImageCounts } from "./dataset-snapshots";
import { readDataset } from "./datasets";
import { listAllModelVersions, readModelVersion } from "./model-registry";
import { countImageStates, listImageRecords, summarize } from "./summaries";
import {
  countActiveTrainingRuns,
  countTrainingRuns,
  listTrainingEpochs,
  listTrainingRunSummaries,
  readTrainingRun,
} from "./training-runs";
import { trainingSummary } from "./training-summary";
import {
  listTrainingWorkers,
  trainingWorkerPresence,
} from "./training-worker-store";

export async function listVersionOverviews(): Promise<VersionOverview[]> {
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
  const [versions, runs, total, inProgress, workers] = await Promise.all([
    listVersionOverviews(),
    listTrainingRunSummaries(),
    countTrainingRuns(),
    countActiveTrainingRuns(),
    listTrainingWorkers(at),
  ]);
  return {
    versions,
    total,
    runs,
    inProgress,
    workersOnline: workers.filter(
      (worker) => trainingWorkerPresence(worker, at) === "online",
    ).length,
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
    complete: countImageStates(records.map(summarize)).complete,
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
