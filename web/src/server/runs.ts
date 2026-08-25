import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { documentFromResult } from "../annotation/prelabel";
import { annotationSchema, type ReviewState } from "../annotation/schema";
import { createLabel, readLabel, updateLabel } from "./labels";
import { imageKey } from "./paths";
import { listRunIds, listStems, readResult } from "./store";

const imageRef = z.object({ runId: z.string(), stem: z.string() });
export type ImageRef = z.infer<typeof imageRef>;

function summarize(runId: string) {
  return listStems(runId).map((stem) => {
    const result = readResult(runId, stem);
    const label = readLabel(imageKey(result.source));
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
  .validator(imageRef)
  .handler(({ data }) => {
    const result = readResult(data.runId, data.stem);
    return { result, label: readLabel(imageKey(result.source)) };
  });

export const initializeLabel = createServerFn({ method: "POST" })
  .validator(imageRef)
  .handler(({ data }) => {
    const result = readResult(data.runId, data.stem);
    return createLabel(
      imageKey(result.source),
      documentFromResult(result, data.runId),
    );
  });

export const saveLabel = createServerFn({ method: "POST" })
  .validator(z.object({ image: imageRef, document: annotationSchema }))
  .handler(({ data }) => {
    const result = readResult(data.image.runId, data.image.stem);
    return updateLabel(imageKey(result.source), data.document);
  });
