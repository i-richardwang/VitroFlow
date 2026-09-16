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
import { modelCatalogue } from "../server/queries/public";

export const getModelCatalogue = createServerFn({ method: "GET" }).handler(() =>
  modelCatalogue(),
);

/** Names a task the workbench did not have: what it is called and what it finds. */
export const addModel = createServerFn({ method: "POST" })
  .validator(modelRequestSchema)
  .handler(({ data }) => createModel(data));

/** Changes how agents annotate a task; what it finds stays fixed. */
export const updateModelAnnotation = createServerFn({ method: "POST" })
  .validator(modelAnnotationRequestSchema)
  .handler(({ data }) => setModelAnnotation(data));

export const removeModel = createServerFn({ method: "POST" })
  .validator(modelRefSchema)
  .handler(async ({ data }) => {
    await deleteModel(data);
  });
