import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";

import { datasetRefSchema } from "../domain/datasets/schema";
import { resourceIdSchema } from "../domain/identifiers/schema";
import { trainingOverridesSchema } from "../domain/training/parameters";
import { YOLO26_SEED_SMALL_RECIPE } from "../domain/training/recipes";
import { trainingControlSchema } from "../domain/training/schema";
import { trainingRunDetail } from "../server/queries/public";
import {
  createTrainingRun,
  controlTrainingRun,
} from "../server/training/public";

export const getTrainingRun = createServerFn({ method: "GET" })
  .validator(datasetRefSchema.extend({ runId: resourceIdSchema }))
  .handler(({ data }) => trainingRunDetail(data.dataset, data.runId));

/**
 * Freezes the reviewed annotations into a snapshot and queues one training run
 * of the recipe with the chosen parameters.
 */
export const startTrainingRun = createServerFn({ method: "POST" })
  .validator(
    datasetRefSchema.extend({
      overrides: trainingOverridesSchema,
      targetWorkerId: resourceIdSchema.nullable(),
    }),
  )
  .handler(({ data }) =>
    createTrainingRun(
      data.dataset,
      {
        ...YOLO26_SEED_SMALL_RECIPE,
        parameters: {
          ...YOLO26_SEED_SMALL_RECIPE.parameters,
          ...data.overrides,
        },
      },
      data.targetWorkerId,
    ),
  );

export const controlTraining = createServerFn({ method: "POST" })
  .validator(
    datasetRefSchema.extend({
      runId: resourceIdSchema,
      attempt: z.number().int().nonnegative(),
      control: trainingControlSchema,
    }),
  )
  .handler(({ data }) =>
    controlTrainingRun(data.dataset, data.runId, data.attempt, data.control),
  );
