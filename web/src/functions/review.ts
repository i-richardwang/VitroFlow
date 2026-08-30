import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { annotationSchema, labelRefSchema } from "../annotation/schema";
import { resourceIdSchema } from "../identifiers/schema";
import { createLabelFromDetection, updateLabel } from "../server/labels";
import { readReview } from "../server/review";

/** Names a review, and the version whose count the reviewer arrived from. */
export const reviewRequestSchema = labelRefSchema.extend({
  version: resourceIdSchema.optional(),
});

export const getReview = createServerFn({ method: "GET" })
  .validator(reviewRequestSchema)
  .handler(({ data: { version, ...ref } }) => readReview(ref, version));

/** Starts the review from what the version the reviewer is looking at found. */
export const initializeLabel = createServerFn({ method: "POST" })
  .validator(labelRefSchema.extend({ versionId: resourceIdSchema }))
  .handler(({ data: { versionId, ...ref } }) =>
    createLabelFromDetection(ref, versionId),
  );

export const saveLabel = createServerFn({ method: "POST" })
  .validator(z.object({ ref: labelRefSchema, document: annotationSchema }))
  .handler(({ data }) => updateLabel(data.ref, data.document));
