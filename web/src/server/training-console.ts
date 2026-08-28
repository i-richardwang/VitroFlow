import type { ModelVersion } from "../models/schema";
import type { TrainingRecipe } from "../training/schema";
import type { TrainingEpoch, TrainingRun } from "../training/schema";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { readDataset } from "./datasets";
import { readModelVersion } from "./model-registry";
import { trainingSummary, type TrainingSummary } from "./overview";
import { countImageStates, listImageRecords, summarize } from "./summaries";
import {
  countActiveTrainingRuns,
  countTrainingRuns,
  listTrainingEpochs,
  listTrainingRunSummaries,
  readTrainingRun,
  type TrainingRunSummary,
} from "./training-runs";
import {
  listTrainingWorkers,
  trainingWorkerPresence,
} from "./training-worker-store";

/** Every dataset's runs on one page. */
export interface TrainingOverview {
  /** Exact count across the full history. */
  total: number;
  /** Newest first. */
  runs: TrainingRunSummary[];
  /** Runs queued, training, or publishing. */
  inProgress: number;
  workersOnline: number;
}

export async function trainingOverview(
  at: Date = new Date(),
): Promise<TrainingOverview> {
  const [runs, total, inProgress, workers] = await Promise.all([
    listTrainingRunSummaries(),
    countTrainingRuns(),
    countActiveTrainingRuns(),
    listTrainingWorkers(at),
  ]);
  return {
    total,
    runs,
    inProgress,
    workersOnline: workers.filter(
      (worker) => trainingWorkerPresence(worker, at) === "online",
    ).length,
  };
}

/** Everything the training page shows for one dataset. */
export interface TrainingConsole {
  dataset: string;
  complete: number;
  recipe: TrainingRecipe;
  training: TrainingSummary;
  /** Newest first. */
  runs: TrainingRunSummary[];
}

export async function trainingConsole(
  datasetId: string,
  at: Date = new Date(),
): Promise<TrainingConsole | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const records = await listImageRecords(datasetId);
  const runs = await listTrainingRunSummaries({ modelId: dataset.modelId });
  return {
    dataset: dataset.id,
    complete: countImageStates(records.map(summarize)).complete,
    recipe: YOLO26_SEED_SMALL_RECIPE,
    training: await trainingSummary(dataset.modelId, records, at),
    runs,
  };
}

/** One run with its whole epoch history and the version it published. */
export interface TrainingRunDetail {
  dataset: string;
  run: TrainingRun;
  epochs: TrainingEpoch[];
  version: ModelVersion | null;
}

export async function trainingRunDetail(
  datasetId: string,
  runId: string,
): Promise<TrainingRunDetail | null> {
  const dataset = await readDataset(datasetId);
  const run = await readTrainingRun(runId);
  if (!dataset || !run || run.modelId !== dataset.modelId) return null;
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
