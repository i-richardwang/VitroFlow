import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { documentFromResult } from "../annotation/prelabel";
import { annotationSchema, type ReviewState } from "../annotation/schema";
import { createLabel, readLabel, updateLabel } from "./labels";
import { listRunIds, listStems, readResult } from "./store";

function summarize(runId: string) {
  return listStems(runId).map((stem) => {
    const result = readResult(runId, stem);
    const label = readLabel(stem);
    return {
      stem,
      review: (label?.status ?? "uninitialized") as ReviewState,
      instanceCount: label?.instances.length ?? null,
      detectionCount: result.count,
      quality: result.quality,
    };
  });
}

export const listRuns = createServerFn({ method: "GET" }).handler(() =>
  listRunIds().map((runId) => {
    const images = summarize(runId);
    return {
      runId,
      imageCount: images.length,
      completedCount: images.filter((image) => image.review === "complete")
        .length,
      flaggedCount: images.filter((image) => image.quality.status !== "ok")
        .length,
    };
  }),
);

export const getRun = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => summarize(data.runId));

export const getImage = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string(), stem: z.string() }))
  .handler(({ data }) => ({
    result: readResult(data.runId, data.stem),
    label: readLabel(data.stem),
  }));

export const initializeLabel = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string(), stem: z.string() }))
  .handler(({ data }) =>
    createLabel(
      data.stem,
      documentFromResult(readResult(data.runId, data.stem), data.runId),
    ),
  );

export const saveLabel = createServerFn({ method: "POST" })
  .validator(z.object({ stem: z.string(), document: annotationSchema }))
  .handler(({ data }) => updateLabel(data.stem, data.document));
