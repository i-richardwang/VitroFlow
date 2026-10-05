import type { Model, ModelVersion } from "../models/schema";
import type { TrainingEpoch, TrainingRun } from "./schema";

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

export interface TrainingRunDetail {
  dataset: string;
  /** The model the run's training set trains. */
  model: Model;
  run: TrainingRun;
  epochs: TrainingEpoch[];
  version: ModelVersion | null;
}
