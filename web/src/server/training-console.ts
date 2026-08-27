import type { ModelVersion } from "../models/schema";
import type { TrainingRecipe } from "../training/schema";
import type { TrainingEpoch, TrainingRun } from "../training/schema";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { readDataset } from "./datasets";
import { readModelVersion } from "./model-registry";
import { trainingSummary, type TrainingSummary } from "./overview";
import { countImageStates, listImageRecords, summarize } from "./summaries";
import {
  latestAttemptEpochs,
  listTrainingEpochs,
  listTrainingRuns,
  readTrainingRun,
} from "./training-runs";

/** The epoch with the highest fitness; what Ultralytics keeps as `best.pt`. */
export function bestEpoch(epochs: TrainingEpoch[]): TrainingEpoch | null {
  let best: TrainingEpoch | null = null;
  for (const epoch of epochs) {
    if (!best || epoch.fitness > best.fitness) best = epoch;
  }
  return best;
}

export interface TrainingRunSummary {
  run: TrainingRun;
  /** Epochs the current attempt has finished. */
  completed: number;
  best: TrainingEpoch | null;
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
  const runs = await listTrainingRuns(dataset.modelId);
  const epochs = await latestAttemptEpochs(runs.map((run) => run.id));
  return {
    dataset: dataset.id,
    complete: countImageStates(records.map(summarize)).complete,
    recipe: YOLO26_SEED_SMALL_RECIPE,
    training: await trainingSummary(dataset.modelId, records, runs, at),
    runs: runs.map((run) => {
      const own = epochs.get(run.id) ?? [];
      return { run, completed: own.length, best: bestEpoch(own) };
    }),
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
