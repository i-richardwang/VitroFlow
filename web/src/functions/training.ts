import { createServerFn } from "@tanstack/react-start";

import { datasetRefSchema } from "../datasets/schema";
import { resourceIdSchema } from "../identifiers/schema";
import { trainingOverridesSchema } from "../training/parameters";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import {
  trainingConsole,
  trainingOverview,
  trainingRunDetail,
} from "../server/training-console";
import { createTrainingRun } from "../server/training-runs";

export const getTrainingConsole = createServerFn({ method: "GET" })
  .validator(datasetRefSchema)
  .handler(({ data }) => trainingConsole(data.dataset));

export const getTrainingOverview = createServerFn({ method: "GET" }).handler(
  () => trainingOverview(),
);

export const getTrainingRun = createServerFn({ method: "GET" })
  .validator(datasetRefSchema.extend({ runId: resourceIdSchema }))
  .handler(({ data }) => trainingRunDetail(data.dataset, data.runId));

/**
 * Freezes the reviewed annotations into a snapshot and queues one training run
 * of the recipe with the chosen parameters.
 */
export const startTrainingRun = createServerFn({ method: "POST" })
  .validator(datasetRefSchema.extend({ overrides: trainingOverridesSchema }))
  .handler(({ data }) =>
    createTrainingRun(data.dataset, {
      ...YOLO26_SEED_SMALL_RECIPE,
      parameters: {
        ...YOLO26_SEED_SMALL_RECIPE.parameters,
        ...data.overrides,
      },
    }),
  );
