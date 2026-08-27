import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { DATASET_NAME } from "../datasets/schema";
import { versionIdSchema } from "../inference/schema";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { selectModelVersion } from "./datasets";
import { datasetOverview } from "./overview";
import { createTrainingRun } from "./training-runs";

const datasetInput = z.object({ dataset: z.string().regex(DATASET_NAME) });

export const getDatasetOverview = createServerFn({ method: "GET" })
  .validator(datasetInput)
  .handler(({ data }) => {
    const overview = datasetOverview(data.dataset);
    if (!overview) {
      throw new Error(`Unknown dataset: ${data.dataset}`);
    }
    return overview;
  });

export const selectDatasetModelVersion = createServerFn({ method: "POST" })
  .validator(datasetInput.extend({ versionId: versionIdSchema }))
  .handler(({ data }) => selectModelVersion(data.dataset, data.versionId));

/** Freezes the reviewed annotations into a snapshot and queues one training run. */
export const startTrainingRun = createServerFn({ method: "POST" })
  .validator(datasetInput)
  .handler(({ data }) => createTrainingRun(data.dataset, YOLO26_SEED_SMALL_RECIPE));
