import type { ModelVersion } from "../models/schema";
import type { TrainingEpoch, TrainingRecipe, TrainingRun } from "./schema";

export interface TrainingRunSummary {
  dataset: string;
  run: TrainingRun;
  completed: number;
  best: { map50: number; map50To95: number } | null;
}

export interface TrainingSummary {
  runs: number;
  active: TrainingRun | null;
  reviewedSinceLastRun: number;
  workersOnline: number;
  workerMemoryBytes: number | null;
}

export interface VersionOverview {
  version: ModelVersion;
  trainingImages: number | null;
}

export interface TrainingOverview {
  versions: VersionOverview[];
  total: number;
  runs: TrainingRunSummary[];
  inProgress: number;
  workersOnline: number;
}

export interface TrainingConsole {
  dataset: string;
  complete: number;
  recipe: TrainingRecipe;
  training: TrainingSummary;
  runs: TrainingRunSummary[];
}

export interface TrainingRunDetail {
  dataset: string;
  run: TrainingRun;
  epochs: TrainingEpoch[];
  version: ModelVersion | null;
}
