import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { annotationRefSchema } from "../domain/annotation/schema";
import { startAnnotationRunSchema } from "../domain/annotation-runs/schema";
import { resourceIdSchema } from "../domain/identifiers/schema";
import {
  annotationWorkers,
  listAnnotationRuns,
  createAnnotationRun,
  cancelAnnotationRun,
} from "../server/annotation-runs/public";
import { readSession } from "../server/transport/http/session";

export const getAnnotationWorkers = createServerFn({ method: "GET" }).handler(
  () => annotationWorkers(),
);
export const getAnnotationRuns = createServerFn({ method: "GET" })
  .validator(annotationRefSchema)
  .handler(({ data }) => listAnnotationRuns(data));
export const startAnnotationRun = createServerFn({ method: "POST" })
  .validator(startAnnotationRunSchema)
  .handler(async ({ data }) => {
    const user = await readSession(getRequestHeaders());
    if (!user) throw new Error("Authentication required");
    return createAnnotationRun(data, user.id);
  });
export const stopAnnotationRun = createServerFn({ method: "POST" })
  .validator(resourceIdSchema)
  .handler(({ data }) => cancelAnnotationRun(data));
