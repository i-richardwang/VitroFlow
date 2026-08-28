import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { DATASET_NAME } from "../datasets/schema";
import { versionIdSchema } from "../inference/schema";
import { tunableParametersSchema } from "../training/parameters";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { selectModelVersion } from "./datasets";
import { datasetOverview } from "./overview";
import {
  trainingConsole,
  trainingOverview,
  trainingRunDetail,
} from "./training-console";
import { createTrainingRun } from "./training-runs";

const datasetInput = z.object({ dataset: z.string().regex(DATASET_NAME) });

export const getDatasetOverview = createServerFn({ method: "GET" })
  .validator(datasetInput)
  .handler(({ data }) => datasetOverview(data.dataset));

export const selectDatasetModelVersion = createServerFn({ method: "POST" })
  .validator(datasetInput.extend({ versionId: versionIdSchema }))
  .handler(({ data }) => selectModelVersion(data.dataset, data.versionId));

export const getTrainingConsole = createServerFn({ method: "GET" })
  .validator(datasetInput)
  .handler(({ data }) => trainingConsole(data.dataset));

export const getTrainingOverview = createServerFn({ method: "GET" }).handler(
  () => trainingOverview(),
);

export const getTrainingRun = createServerFn({ method: "GET" })
  .validator(datasetInput.extend({ runId: versionIdSchema }))
  .handler(({ data }) => trainingRunDetail(data.dataset, data.runId));

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
