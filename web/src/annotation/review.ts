import { z } from "zod";

import { detectionResultSchema } from "../detection/schema";
import { documentFromDetection } from "./detection";
import {
  annotationRefSchema,
  annotationSchema,
  type AnnotationDocument,
  type AnnotationInstance,
} from "./schema";

/**
 * One image as it is reviewed for one model, wherever the image is shown.
 *
 * `detection` is where the boxes come from: the version the page shows, or
 * the model's newest that has detected the image. `annotation` is the review
 * as it was last saved, and is absent until the reviewer's first edit. Each
 * is looked up on its own, and every combination of the two says something:
 * neither means nothing has looked at the image yet, an annotation without a
 * detection is one that arrived with a dataset from another workbench, and a
 * detection without an annotation is a review to be made.
 */
export const reviewSchema = z.strictObject({
  ref: annotationRefSchema,
  filename: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  detection: detectionResultSchema.nullable(),
  annotation: annotationSchema.nullable(),
});

export type Review = z.infer<typeof reviewSchema>;

/**
 * The document the page shows and the editor opens on: the saved review, or
 * a copy of the detection that reaches the database on the reviewer's first
 * edit. Null while neither exists and there is nothing yet to review.
 */
export function reviewDocument(review: Review): AnnotationDocument | null {
  if (review.annotation) return review.annotation;
  return review.detection ? documentFromDetection(review.detection) : null;
}

/**
 * Which boxes a page shows outside the editor: the review, or what the model
 * found before anyone touched it. Editing always works on the review.
 */
export const REVIEW_VERSIONS = ["review", "detection"] as const;

export type ReviewVersion = (typeof REVIEW_VERSIONS)[number];

export function versionInstances(
  review: Review,
  version: ReviewVersion,
): AnnotationInstance[] {
  const document =
    version === "detection"
      ? review.detection && documentFromDetection(review.detection)
      : reviewDocument(review);
  return document?.instances ?? [];
}
