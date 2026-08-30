import type { Dataset, ImageState } from "../datasets/schema";
import type { Model } from "../models/schema";
import { readDataset } from "./datasets";
import { readModel } from "./model-registry";
import {
  countImageStates,
  listImageRecords,
  summarize,
  type ImageSummary,
} from "./summaries";
import { trainingSummary, type TrainingSummary } from "./training-summary";

/** The model, images, review progress, and training state a dataset page shows. */
export interface DatasetOverview {
  dataset: Dataset;
  model: Model;
  images: ImageSummary[];
  counts: Record<ImageState, number>;
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
  const summaries = records.map(summarize);
  return {
    dataset,
    model,
    images: summaries,
    counts: countImageStates(summaries),
    training: await trainingSummary(dataset, records, at),
  };
}
