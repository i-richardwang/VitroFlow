import { createServerFn } from "@tanstack/react-start";

import {
  datasetImageRefSchema,
  datasetImageAdditionSchema,
  datasetRefSchema,
} from "../datasets/schema";
import {
  addExperimentObservationImages,
  listDatasets,
  removeDatasetImage,
} from "../server/datasets";
import { datasetOverview } from "../server/dataset-overview";
import { summarizeDataset } from "../server/summaries";

export const getDatasetOverview = createServerFn({ method: "GET" })
  .validator(datasetRefSchema)
  .handler(({ data }) => datasetOverview(data.dataset));

export const getDatasets = createServerFn({ method: "GET" }).handler(async () =>
  Promise.all(
    (await listDatasets()).map((dataset) =>
      summarizeDataset(dataset.id, dataset.modelId),
    ),
  ),
);

/** Adds experiment images to a dataset, creating it on first use. */
export const addToDataset = createServerFn({ method: "POST" })
  .validator(datasetImageAdditionSchema)
  .handler(({ data }) => addExperimentObservationImages(data));

export const removeFromDataset = createServerFn({ method: "POST" })
  .validator(datasetImageRefSchema)
  .handler(async ({ data }) => {
    await removeDatasetImage(data);
  });
