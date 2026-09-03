import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { annotationSchema, annotationRefSchema } from "../annotation/schema";
import { resourceIdSchema } from "../identifiers/schema";
import {
  startAnnotationFromDetection,
  updateAnnotation,
} from "../server/annotations";
import { readReview } from "../server/review";

/** Names a review and the version whose observation the reviewer arrived from. */
export const reviewRequestSchema = annotationRefSchema.extend({
  version: resourceIdSchema.optional(),
});

export const getReview = createServerFn({ method: "GET" })
  .validator(reviewRequestSchema)
  .handler(({ data: { version, ...ref } }) => readReview(ref, version));

/** Starts the review, or starts it again, from what the shown version found. */
export const startAnnotation = createServerFn({ method: "POST" })
  .validator(annotationRefSchema.extend({ versionId: resourceIdSchema }))
  .handler(({ data: { versionId, ...ref } }) =>
    startAnnotationFromDetection(ref, versionId),
  );

export const saveAnnotation = createServerFn({ method: "POST" })
  .validator(
    z.strictObject({ ref: annotationRefSchema, document: annotationSchema }),
  )
  .handler(({ data }) => updateAnnotation(data.ref, data.document));
