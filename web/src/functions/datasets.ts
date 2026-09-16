import { createServerFn } from "@tanstack/react-start";

import {
  datasetImageRefSchema,
  datasetImageAdditionSchema,
  datasetRefSchema,
} from "../domain/datasets/schema";
import {
  addExperimentObservationImages,
  listDatasets,
  removeDatasetImage,
  summarizeDataset,
} from "../server/datasets/public";
import { availableAnnotationRuntimes } from "../server/annotation-runs/public";
import { readDatasetImage, datasetOverview } from "../server/queries/public";

/** The dataset with the agents its pages may ask to annotate for it. */
export const getDatasetOverview = createServerFn({ method: "GET" })
  .validator(datasetRefSchema)
  .handler(async ({ data }) => {
    const overview = await datasetOverview(data.dataset);
    if (!overview) return null;
    return { ...overview, agents: await availableAnnotationRuntimes() };
  });

export const getDatasetImage = createServerFn({ method: "GET" })
  .validator(datasetImageRefSchema)
  .handler(async ({ data }) => {
    const view = await readDatasetImage(data);
    if (!view) return null;
    return { ...view, agents: await availableAnnotationRuntimes() };
  });

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
