import { createServerFn } from "@tanstack/react-start";

import {
  dishAssignmentSchema,
  dishEventRequestSchema,
  dishEventVoidSchema,
  dishLayoutSchema,
  dishRefSchema,
  dishUpdateSchema,
  dishRequestSchema,
  experimentRefSchema,
  experimentRequestSchema,
  experimentUpdateSchema,
  photoFilingSchema,
  photoMoveSchema,
  photoRefSchema,
  observationRefSchema,
  observationRequestSchema,
  observationUpdateSchema,
  treatmentReplicatesSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentUpdateSchema,
} from "../experiments/schema";
import { listDatasetsForModel } from "../server/datasets";
import {
  addDishes,
  addTreatment,
  addTreatmentReplicates,
  assignDishes,
  createExperiment,
  deleteDish,
  deleteExperiment,
  deleteTreatment,
  updateDish,
  updateExperiment,
  updateTreatment,
} from "../server/experiment-design";
import { recordDishEvent, voidDishEvent } from "../server/experiment-events";
import {
  addObservation,
  deleteObservation,
  filePhotos,
  movePhoto,
  removePhoto,
  retryExperimentDetection,
  updateObservation,
} from "../server/experiment-observations";
import {
  listExperiments,
  readExperimentDish,
  readExperimentGrid,
} from "../server/experiment-queries";
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

export const createTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRequestSchema)
  .handler(({ data }) => addTreatment(data));

export const editTreatment = createServerFn({ method: "POST" })
  .validator(treatmentUpdateSchema)
  .handler(({ data }) => updateTreatment(data));

export const removeTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRefSchema)
  .handler(({ data }) => deleteTreatment(data));

export const createDishes = createServerFn({ method: "POST" })
  .validator(dishLayoutSchema)
  .handler(({ data }) => addDishes(data));

export const createTreatmentReplicates = createServerFn({ method: "POST" })
  .validator(treatmentReplicatesSchema)
  .handler(({ data }) => addTreatmentReplicates(data));

export const editDish = createServerFn({ method: "POST" })
  .validator(dishUpdateSchema)
  .handler(({ data }) => updateDish(data));

export const createDishEvent = createServerFn({ method: "POST" })
  .validator(dishEventRequestSchema)
  .handler(({ data }) => recordDishEvent(data));

export const correctDishEvent = createServerFn({ method: "POST" })
  .validator(dishEventVoidSchema)
  .handler(({ data }) => voidDishEvent(data));

export const removeDish = createServerFn({ method: "POST" })
  .validator(dishRefSchema)
  .handler(({ data }) => deleteDish(data));

export const placeDishes = createServerFn({ method: "POST" })
  .validator(dishAssignmentSchema)
  .handler(({ data }) => assignDishes(data));

export const createObservation = createServerFn({ method: "POST" })
  .validator(observationRequestSchema)
  .handler(({ data }) => addObservation(data));

export const editObservation = createServerFn({ method: "POST" })
  .validator(observationUpdateSchema)
  .handler(({ data }) => updateObservation(data));

export const removeObservation = createServerFn({ method: "POST" })
  .validator(observationRefSchema)
  .handler(({ data }) => deleteObservation(data));

export const filePhotographs = createServerFn({ method: "POST" })
  .validator(photoFilingSchema)
  .handler(({ data }) => filePhotos(data));

export const refilePhotograph = createServerFn({ method: "POST" })
  .validator(photoMoveSchema)
  .handler(({ data }) => movePhoto(data));

export const removePhotograph = createServerFn({ method: "POST" })
  .validator(photoRefSchema)
  .handler(({ data }) => removePhoto(data));

export const getExperimentDish = createServerFn({ method: "GET" })
  .validator(dishRequestSchema)
  .handler(async ({ data: { observation, ...ref } }) => {
    const series = await readExperimentDish(ref, observation);
    if (!series) return null;
    return { ...series, datasets: await datasetsTraining(series.model.id) };
  });

export const retryPhotoDetection = createServerFn({ method: "POST" })
  .validator(photoRefSchema)
  .handler(async ({ data }) => {
    await retryExperimentDetection(data);
  });
