import { createServerFn } from "@tanstack/react-start";

import {
  experimentRefSchema,
  experimentRequestSchema,
  photoRefSchema,
} from "../experiments/schema";
import { listDatasetsForModel } from "../server/datasets";
import {
  createExperiment,
  listExperiments,
  readExperimentGrid,
  readExperimentPhoto,
  retryExperimentDetection,
} from "../server/experiments";
import { listAllModelVersions } from "../server/model-registry";

/** The datasets that train the model, where its photographs may be added. */
async function datasetsTraining(modelId: string): Promise<string[]> {
  return (await listDatasetsForModel(modelId)).map((dataset) => dataset.id);
}

export const getExperiments = createServerFn({ method: "GET" }).handler(() =>
  listExperiments(),
);

/** The versions an experiment may count with, newest first; never empty. */
export const getExperimentVersions = createServerFn({ method: "GET" }).handler(
  () => listAllModelVersions(),
);

export const getExperimentGrid = createServerFn({ method: "GET" })
  .validator(experimentRefSchema)
  .handler(async ({ data }) => {
    const grid = await readExperimentGrid(data.experiment);
    if (!grid) return null;
    return { ...grid, datasets: await datasetsTraining(grid.version.modelId) };
  });

export const startExperiment = createServerFn({ method: "POST" })
  .validator(experimentRequestSchema)
  .handler(({ data }) => createExperiment(data));

export const getExperimentPhoto = createServerFn({ method: "GET" })
  .validator(photoRefSchema)
  .handler(async ({ data }) => {
    const photo = await readExperimentPhoto(data);
    if (!photo) return null;
    return { ...photo, datasets: await datasetsTraining(photo.modelId) };
  });

export const retryPhotoDetection = createServerFn({ method: "POST" })
  .validator(photoRefSchema)
  .handler(async ({ data }) => {
    await retryExperimentDetection(data);
  });
