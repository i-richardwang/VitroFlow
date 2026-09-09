import type { Dataset } from "../../datasets/schema";
import type { Model } from "../../models/schema";
import type { TrainingSummary } from "../../training/read-model";
import {
  readDataset,
  countReviewed,
  listImageRecords,
  summarize,
  type ImageSummary,
} from "../datasets/public";
import { readModel } from "../models/public";

import { trainingSummary } from "./training-summary";

/** The model, images, review progress, and training state a dataset page shows. */
interface DatasetOverview {
  dataset: Dataset;
  model: Model;
  images: ImageSummary[];
  reviewedCount: number;
  training: TrainingSummary;
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
  };
}
