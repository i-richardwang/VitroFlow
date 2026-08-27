import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { annotationSchema } from "../annotation/schema";
import { imageRefSchema } from "../datasets/schema";
import { listDatasets, notInDataset, removeImage } from "./datasets";
import { createLabelFromPrelabel, updateLabel } from "./labels";
import { discardPrelabel } from "./prelabels";
import { readImageRecord, summarize, summarizeDataset } from "./summaries";

export const getDatasets = createServerFn({ method: "GET" }).handler(async () =>
  Promise.all((await listDatasets()).map(summarizeDataset)),
);

export const getImage = createServerFn({ method: "GET" })
  .validator(imageRefSchema)
  .handler(async ({ data }) => {
    const record = await readImageRecord(data);
    if (!record) throw notInDataset(data);
    return {
      summary: summarize(record),
      prelabel: record.prelabel,
      label: record.label,
    };
  });

export const initializeLabel = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(({ data }) => createLabelFromPrelabel(data));

export const saveLabel = createServerFn({ method: "POST" })
  .validator(z.object({ image: imageRefSchema, document: annotationSchema }))
  .handler(({ data }) => updateLabel(data.image, data.document));

export const retryPrelabel = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(async ({ data }) => {
    await discardPrelabel(data);
  });

export const deleteImage = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(async ({ data }) => {
    await removeImage(data);
  });
