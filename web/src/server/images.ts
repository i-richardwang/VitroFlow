import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { documentFromPrelabel } from "../annotation/prelabel";
import { annotationSchema } from "../annotation/schema";
import { imageRefSchema } from "../datasets/schema";
import { isFailure } from "../detection/schema";
import { listDatasets, listImages, removeImage } from "./datasets";
import { createLabel, readLabel, updateLabel } from "./labels";
import { discardPrelabel, readPrelabel } from "./prelabels";
import { summarizeDataset, summarizeImage } from "./summaries";

const datasetInput = z.object({ dataset: z.string() });

export const getDatasets = createServerFn({ method: "GET" }).handler(() =>
  listDatasets().map(summarizeDataset),
);

export const getDataset = createServerFn({ method: "GET" })
  .validator(datasetInput)
  .handler(({ data }) => listImages(data.dataset).map(summarizeImage));

export const getImage = createServerFn({ method: "GET" })
  .validator(imageRefSchema)
  .handler(({ data }) => ({
    summary: summarizeImage(data),
    prelabel: readPrelabel(data),
    label: readLabel(data),
  }));

export const initializeLabel = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(({ data }) => {
    const prelabel = readPrelabel(data);
    if (!prelabel || isFailure(prelabel)) {
      throw new Error("The image has no detections to start from");
    }
    return createLabel(data, documentFromPrelabel(prelabel));
  });

export const saveLabel = createServerFn({ method: "POST" })
  .validator(z.object({ image: imageRefSchema, document: annotationSchema }))
  .handler(({ data }) => updateLabel(data.image, data.document));

export const retryPrelabel = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(({ data }) => {
    discardPrelabel(data);
  });

export const deleteImage = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(({ data }) => {
    removeImage(data);
  });
