import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { DATASET_NAME } from "../datasets/schema";
import { versionIdSchema } from "../inference/schema";
import { tunableParametersSchema } from "../training/parameters";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { selectModelVersion } from "./datasets";
import { datasetOverview } from "./overview";
import { trainingConsole, trainingRunDetail } from "./training-console";
import { createTrainingRun } from "./training-runs";

const datasetInput = z.object({ dataset: z.string().regex(DATASET_NAME) });

export const getDatasetOverview = createServerFn({ method: "GET" })
  .validator(datasetInput)
  .handler(async ({ data }) => {
    const overview = await datasetOverview(data.dataset);
    if (!overview) {
      throw new Error(`Unknown dataset: ${data.dataset}`);
    }
    return overview;
  });

export const selectDatasetModelVersion = createServerFn({ method: "POST" })
  .validator(datasetInput.extend({ versionId: versionIdSchema }))
  .handler(({ data }) => selectModelVersion(data.dataset, data.versionId));

export const getTrainingConsole = createServerFn({ method: "GET" })
  .validator(datasetInput)
  .handler(async ({ data }) => {
    const console = await trainingConsole(data.dataset);
    if (!console) throw new Error(`Unknown dataset: ${data.dataset}`);
    return console;
  });

export const getTrainingRun = createServerFn({ method: "GET" })
  .validator(datasetInput.extend({ runId: versionIdSchema }))
  .handler(async ({ data }) => {
    const detail = await trainingRunDetail(data.dataset, data.runId);
    if (!detail) throw new Error(`Unknown training run: ${data.runId}`);
    return detail;
  });

/**
 * Freezes the reviewed annotations into a snapshot and queues one training run
 * of the recipe with the chosen parameters.
 */
export const startTrainingRun = createServerFn({ method: "POST" })
  .validator(datasetInput.extend({ parameters: tunableParametersSchema }))
  .handler(({ data }) =>
    createTrainingRun(data.dataset, {
      ...YOLO26_SEED_SMALL_RECIPE,
      parameters: {
        ...YOLO26_SEED_SMALL_RECIPE.parameters,
        ...data.parameters,
      },
    }),
  );
