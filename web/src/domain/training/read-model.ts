import type { Model, ModelVersion } from "../models/schema";
import type { TrainingEpoch, TrainingRun } from "./schema";

export interface TrainingRunSummary {
  dataset: string;
  run: TrainingRun;
  completed: number;
  best: { map50: number; map50To95: number } | null;
}

/** Whether a training set can start a run now, and what the run would train on. */
export interface TrainingSummary {
  /** The model's run in progress, whichever training set feeds it. */
  active: TrainingRun | null;
  reviewedSinceLastRun: number;
  /** The least memory among the online trainers, or null when none is online. */
  workerMemoryBytes: number | null;
}

export interface VersionOverview {
  version: ModelVersion;
  trainingImages: number | null;
}

export interface TrainingRunDetail {
  /** The model the run's training set trains. */
  model: Model;
  run: TrainingRun;
  epochs: TrainingEpoch[];
  version: ModelVersion | null;
}
