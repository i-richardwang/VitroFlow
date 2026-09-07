import { createServerFn } from "@tanstack/react-start";

import {
  cultureEventRequestSchema,
  cultureEventRefSchema,
  experimentRefSchema,
  experimentRequestSchema,
  experimentUpdateSchema,
  observationImageAssignmentSchema,
  observationImageMoveSchema,
  observationImageRefSchema,
  observationRefSchema,
  observationRequestSchema,
  observationUpdateSchema,
  replicateRequestSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentUpdateSchema,
  unitRefSchema,
  unitRequestSchema,
  unitUpdateSchema,
} from "../experiments/schema";
import { listDatasetsForModel } from "../server/datasets";
import {
  addReplicates,
  addTreatment,
  createExperiment,
  deleteExperiment,
  deleteTreatment,
  deleteUnit,
  updateExperiment,
  updateTreatment,
  updateUnit,
} from "../server/experiment-design";
import {
  deleteCultureEvent,
  recordCultureEvent,
} from "../server/culture-events";
import * as observationImages from "../server/experiment-observation-images";
import {
  addObservation,
  deleteObservation,
  updateObservation,
} from "../server/experiment-observations";
import {
  listExperiments,
  readUnit,
  readExperimentGrid,
} from "../server/experiment-queries";
import { listAllModelVersions, listModels } from "../server/model-registry";

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

export const createReplicates = createServerFn({ method: "POST" })
  .validator(replicateRequestSchema)
  .handler(({ data }) => addReplicates(data));

export const getUnit = createServerFn({ method: "GET" })
  .validator(unitRequestSchema)
  .handler(async ({ data: { observation, ...ref } }) => {
    const series = await readUnit(ref, observation);
    if (!series) return null;
    return { ...series, datasets: await datasetsTraining(series.model.id) };
  });

export const editUnit = createServerFn({ method: "POST" })
  .validator(unitUpdateSchema)
  .handler(({ data }) => updateUnit(data));

export const removeUnit = createServerFn({ method: "POST" })
  .validator(unitRefSchema)
  .handler(({ data }) => deleteUnit(data));

export const createCultureEvent = createServerFn({ method: "POST" })
  .validator(cultureEventRequestSchema)
  .handler(({ data }) => recordCultureEvent(data));

export const removeCultureEvent = createServerFn({ method: "POST" })
  .validator(cultureEventRefSchema)
  .handler(({ data }) => deleteCultureEvent(data));

export const createObservation = createServerFn({ method: "POST" })
  .validator(observationRequestSchema)
  .handler(({ data }) => addObservation(data));

export const editObservation = createServerFn({ method: "POST" })
  .validator(observationUpdateSchema)
  .handler(({ data }) => updateObservation(data));

export const removeObservation = createServerFn({ method: "POST" })
  .validator(observationRefSchema)
  .handler(({ data }) => deleteObservation(data));

export const assignImagesToObservation = createServerFn({ method: "POST" })
  .validator(observationImageAssignmentSchema)
  .handler(({ data }) => observationImages.assignObservationImages(data));

export const reassignObservationImage = createServerFn({ method: "POST" })
  .validator(observationImageMoveSchema)
  .handler(({ data }) => observationImages.moveObservationImage(data));

export const unassignObservationImage = createServerFn({ method: "POST" })
  .validator(observationImageRefSchema)
  .handler(({ data }) => observationImages.unassignObservationImage(data));

export const retryObservationImageAnalysis = createServerFn({ method: "POST" })
  .validator(observationImageRefSchema)
  .handler(async ({ data }) => {
    await observationImages.retryObservationImageAnalysis(data);
  });
