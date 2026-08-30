import { createServerFn } from "@tanstack/react-start";

import {
  dishRequestSchema,
  experimentRefSchema,
  experimentRequestSchema,
  photoRefSchema,
} from "../experiments/schema";
import { listDatasetsForModel } from "../server/datasets";
import {
  createExperiment,
  listExperiments,
  readExperimentDish,
  readExperimentGrid,
  retryExperimentDetection,
} from "../server/experiments";
import { listAllModelVersions, listModels } from "../server/model-registry";

/** The datasets that train the model, where its photographs may be added. */
async function datasetsTraining(modelId: string): Promise<string[]> {
  return (await listDatasetsForModel(modelId)).map((dataset) => dataset.id);
}

export const getExperiments = createServerFn({ method: "GET" }).handler(() =>
  listExperiments(),
);

/** The versions an experiment may read with, newest first; never empty. */
export const getExperimentVersions = createServerFn({ method: "GET" }).handler(
  async () => {
    const [models, versions] = await Promise.all([
      listModels(),
      listAllModelVersions(),
    ]);
    const byId = new Map(models.map((model) => [model.id, model]));
    return versions.map((version) => {
      const model = byId.get(version.modelId);
      if (!model) throw new Error(`Unknown model: ${version.modelId}`);
      return { model, version };
    });
  },
);

export const getExperimentGrid = createServerFn({ method: "GET" })
  .validator(experimentRefSchema)
  .handler(async ({ data }) => {
    const grid = await readExperimentGrid(data.experiment);
    if (!grid) return null;
    return { ...grid, datasets: await datasetsTraining(grid.model.id) };
  });

export const startExperiment = createServerFn({ method: "POST" })
  .validator(experimentRequestSchema)
  .handler(({ data }) => createExperiment(data));

export const getExperimentDish = createServerFn({ method: "GET" })
  .validator(dishRequestSchema)
  .handler(async ({ data: { round, ...ref } }) => {
    const series = await readExperimentDish(ref, round);
    if (!series) return null;
    return { ...series, datasets: await datasetsTraining(series.model.id) };
  });

export const retryPhotoDetection = createServerFn({ method: "POST" })
  .validator(photoRefSchema)
  .handler(async ({ data }) => {
    await retryExperimentDetection(data);
  });
