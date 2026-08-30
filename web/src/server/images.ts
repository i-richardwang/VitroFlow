import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { annotationSchema } from "../annotation/schema";
import { imageRefSchema } from "../datasets/schema";
import { listDatasets, removeImage } from "./datasets";
import { retryDatasetDetection } from "./detections";
import { createLabelFromDetection, updateLabel } from "./labels";
import { readImageRecord, summarize, summarizeDataset } from "./summaries";

export const getDatasets = createServerFn({ method: "GET" }).handler(async () =>
  Promise.all((await listDatasets()).map(summarizeDataset)),
);

export const getImage = createServerFn({ method: "GET" })
  .validator(imageRefSchema)
  .handler(async ({ data }) => {
    const record = await readImageRecord(data);
    if (!record) return null;
    return {
      summary: summarize(record),
      detection: record.detection,
      failure: record.failure,
      label: record.label,
    };
  });

export const initializeLabel = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(({ data }) => createLabelFromDetection(data));

export const saveLabel = createServerFn({ method: "POST" })
  .validator(z.object({ image: imageRefSchema, document: annotationSchema }))
  .handler(({ data }) => updateLabel(data.image, data.document));

export const retryImageDetection = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(async ({ data }) => {
    await retryDatasetDetection(data);
  });

export const deleteImage = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(async ({ data }) => {
    await removeImage(data);
  });
