import { createServerFn } from "@tanstack/react-start";

import { modelRefSchema, modelRequestSchema } from "../domain/models/schema";
import { createModel, deleteModel } from "../server/models/public";
import { modelCatalogue } from "../server/queries/public";

export const getModelCatalogue = createServerFn({ method: "GET" }).handler(() =>
  modelCatalogue(),
);

/** Names a task the workbench did not have: what it is called and what it finds. */
export const addModel = createServerFn({ method: "POST" })
  .validator(modelRequestSchema)
  .handler(({ data }) => createModel(data));

export const removeModel = createServerFn({ method: "POST" })
  .validator(modelRefSchema)
  .handler(async ({ data }) => {
    await deleteModel(data);
  });
