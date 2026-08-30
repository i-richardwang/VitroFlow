import { createServerFn } from "@tanstack/react-start";

import {
  experimentRefSchema,
  experimentRequestSchema,
  photoRefSchema,
} from "../experiments/schema";
import {
  createExperiment,
  listExperiments,
  readExperimentGrid,
  readExperimentPhoto,
  retryExperimentDetection,
} from "./experiments";
import { listTrainedVersions } from "./model-registry";

export const getExperiments = createServerFn({ method: "GET" }).handler(() =>
  listExperiments(),
);

/** The versions an experiment may count with, newest first. */
export const getTrainedVersions = createServerFn({ method: "GET" }).handler(
  () => listTrainedVersions(),
);

export const getExperimentGrid = createServerFn({ method: "GET" })
  .validator(experimentRefSchema)
  .handler(({ data }) => readExperimentGrid(data.experiment));

export const startExperiment = createServerFn({ method: "POST" })
  .validator(experimentRequestSchema)
  .handler(({ data }) => createExperiment(data));

export const getExperimentPhoto = createServerFn({ method: "GET" })
  .validator(photoRefSchema)
  .handler(({ data }) => readExperimentPhoto(data));

export const retryPhotoDetection = createServerFn({ method: "POST" })
  .validator(photoRefSchema)
  .handler(async ({ data }) => {
    await retryExperimentDetection(data);
  });
