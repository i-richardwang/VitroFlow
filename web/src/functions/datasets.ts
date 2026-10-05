import { createServerFn } from "@tanstack/react-start";

import {
  datasetImageRefSchema,
  datasetImageAdditionSchema,
  datasetRefSchema,
} from "../domain/datasets/schema";
import {
  addExperimentObservationImages,
  removeDatasetImage,
} from "../server/datasets/public";
import { readDatasetImage, datasetOverview } from "../server/queries/public";

export const getDatasetOverview = createServerFn({ method: "GET" })
  .validator(datasetRefSchema)
  .handler(({ data }) => datasetOverview(data.dataset));

export const getDatasetImage = createServerFn({ method: "GET" })
  .validator(datasetImageRefSchema)
  .handler(({ data }) => readDatasetImage(data));

export const addToDataset = createServerFn({ method: "POST" })
  .validator(datasetImageAdditionSchema)
  .handler(({ data }) => addExperimentObservationImages(data));

export const removeFromDataset = createServerFn({ method: "POST" })
  .validator(datasetImageRefSchema)
  .handler(async ({ data }) => {
    await removeDatasetImage(data);
  });
