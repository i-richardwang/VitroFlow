import { createServerFn } from "@tanstack/react-start";

import {
  dishAssignmentSchema,
  dishRequestSchema,
  experimentRefSchema,
  experimentRequestSchema,
  experimentUpdateSchema,
  photoRefSchema,
  roundRefSchema,
  roundRequestSchema,
  roundResultSchema,
  roundUpdateSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentUpdateSchema,
} from "../experiments/schema";
import { listDatasetsForModel } from "../server/datasets";
import {
  addTreatment,
  assignDish,
  createExperiment,
  deleteExperiment,
  deleteTreatment,
  renameTreatment,
  updateExperiment,
} from "../server/experiment-design";
import {
  addRound,
  deleteRound,
  listExperiments,
  readExperimentDish,
  readExperimentGrid,
  retryExperimentDetection,
  updateRound,
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

export const editExperiment = createServerFn({ method: "POST" })
  .validator(experimentUpdateSchema)
  .handler(({ data }) => updateExperiment(data));

export const removeExperiment = createServerFn({ method: "POST" })
  .validator(experimentRefSchema)
  .handler(({ data }) => deleteExperiment(data));

export const editRound = createServerFn({ method: "POST" })
  .validator(roundUpdateSchema)
  .handler(({ data }) => updateRound(data));

export const createRound = createServerFn({ method: "POST" })
  .validator(roundRequestSchema)
  .handler(async ({ data }) => roundResultSchema.parse(await addRound(data)));

export const removeRound = createServerFn({ method: "POST" })
  .validator(roundRefSchema)
  .handler(({ data }) => deleteRound(data));

export const createTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRequestSchema)
  .handler(({ data }) => addTreatment(data));

export const editTreatment = createServerFn({ method: "POST" })
  .validator(treatmentUpdateSchema)
  .handler(({ data }) => renameTreatment(data));

export const removeTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRefSchema)
  .handler(({ data }) => deleteTreatment(data));

export const placeDish = createServerFn({ method: "POST" })
  .validator(dishAssignmentSchema)
  .handler(({ data }) => assignDish(data));

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
