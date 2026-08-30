import { createServerFn } from "@tanstack/react-start";

import {
  datasetImageRefSchema,
  datasetPhotoAdditionSchema,
  datasetRefSchema,
} from "../datasets/schema";
import {
  addExperimentPhotos,
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

/** Adds experiment photographs to a dataset, creating it on first use. */
export const addToDataset = createServerFn({ method: "POST" })
  .validator(datasetPhotoAdditionSchema)
  .handler(({ data }) => addExperimentPhotos(data));

export const removeFromDataset = createServerFn({ method: "POST" })
  .validator(datasetImageRefSchema)
  .handler(async ({ data }) => {
    await removeDatasetImage(data);
  });
