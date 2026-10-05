import type { Dataset } from "../../domain/datasets/schema";
import type { Model } from "../../domain/models/schema";
import type {
  TrainingRunSummary,
  TrainingSummary,
} from "../../domain/training/read-model";
import { YOLO26_SEED_SMALL_RECIPE } from "../../domain/training/recipes";
import type { TrainingRecipe } from "../../domain/training/schema";
import {
  readDataset,
  countReviewed,
  listImageRecords,
  summarize,
  type ImageSummary,
} from "../datasets/public";
import { readModel } from "../models/public";
import { listTrainingRunSummaries } from "../training/public";

import { trainingSummary } from "./training-summary";

/**
 * What a training set's page shows: its model and images, how many are
 * reviewed and so train, the state of training with the recipe a new run
 * starts from, and the set's runs.
 */
interface DatasetOverview {
  dataset: Dataset;
  model: Model;
  images: ImageSummary[];
  reviewedCount: number;
  training: TrainingSummary;
  recipe: TrainingRecipe;
  runs: TrainingRunSummary[];
}

export async function datasetOverview(
  datasetId: string,
  at: Date = new Date(),
): Promise<DatasetOverview | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const model = await readModel(dataset.modelId);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const records = await listImageRecords(datasetId);
  return {
    dataset,
    model,
    images: records.map(summarize),
    reviewedCount: countReviewed(records),
    training: await trainingSummary(dataset, records, at),
    recipe: YOLO26_SEED_SMALL_RECIPE,
    runs: await listTrainingRunSummaries({ datasetId: dataset.id }),
  };
}
