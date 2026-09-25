import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { startAnnotationRunSchema } from "../domain/annotation-runs/schema";
import { datasetRefSchema } from "../domain/datasets/schema";
import { observationRefSchema } from "../domain/experiments/schema";
import { annotationRefSchema } from "../domain/annotation/schema";
import {
  createAnnotationRun,
  createAnnotationRuns,
  cancelAnnotationRun,
} from "../server/annotation-runs/public";
import { listImageRecords } from "../server/datasets/public";
import { listUnreviewedObservationImages } from "../server/experiments/public";
import { readSession } from "../server/transport/http/session";

async function requireUser() {
  const user = await readSession(getRequestHeaders());
  if (!user) throw new Error("Authentication required");
  return user;
}

export const startAnnotationRun = createServerFn({ method: "POST" })
  .validator(startAnnotationRunSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createAnnotationRun(data, "worker", user.id);
  });

export const stopAnnotationRun = createServerFn({ method: "POST" })
  .validator(annotationRefSchema)
  .handler(({ data }) => cancelAnnotationRun(data));

export const annotateDatasetImages = createServerFn({ method: "POST" })
  .validator(datasetRefSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const refs = (await listImageRecords(data.dataset))
      .filter((record) => record.annotation === null)
      .map((record) => ({
        digest: record.image.digest,
        modelId: record.modelId,
      }));
    return createAnnotationRuns(refs, user.id);
  });

export const annotateObservationImages = createServerFn({ method: "POST" })
  .validator(observationRefSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const refs = await listUnreviewedObservationImages(
      data.experiment,
      data.observation,
    );
    return createAnnotationRuns(refs, user.id);
  });
