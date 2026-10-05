import { createServerFn } from "@tanstack/react-start";

import {
  modelAnnotationRequestSchema,
  modelRefSchema,
  modelRequestSchema,
} from "../domain/models/schema";
import {
  createModel,
  deleteModel,
  setModelAnnotation,
} from "../server/models/public";
import { modelCatalogue, modelOverview } from "../server/queries/public";

export const getModelCatalogue = createServerFn({ method: "GET" }).handler(() =>
  modelCatalogue(),
);

export const getModelOverview = createServerFn({ method: "GET" })
  .validator(modelRefSchema)
  .handler(({ data }) => modelOverview(data.model));

export const addModel = createServerFn({ method: "POST" })
  .validator(modelRequestSchema)
  .handler(({ data }) => createModel(data));

export const updateModelAnnotation = createServerFn({ method: "POST" })
  .validator(modelAnnotationRequestSchema)
  .handler(({ data }) => setModelAnnotation(data));

export const removeModel = createServerFn({ method: "POST" })
  .validator(modelRefSchema)
  .handler(async ({ data }) => {
    await deleteModel(data);
  });
