import { z } from "zod";

import { detectionResultSchema } from "../detection/schema";
import { instancesFromDetection } from "./detection";
import {
  annotationRefSchema,
  annotationSchema,
  type AnnotationInstance,
} from "./schema";

/**
 * One image as it is reviewed for one model, wherever the image is shown.
 *
 * `detection` is where a review begins: the version the page shows, or the
 * model's newest that has detected the image. `annotation` is the review as
 * the reviewer last stored it. Each is looked up on its own, and every
 * combination of the two says something: neither means nothing has looked
 * at the image yet, an annotation without a detection is one that arrived
 * with a dataset from another workbench, and a detection without an
 * annotation is a review to be made.
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
 * The instances of the review: the stored ones, else the detection's, which a
 * review begins from. An image no model has read begins from none, which is
 * how a reviewer counts for a model that has never been trained.
 */
export function reviewInstances(review: Review): AnnotationInstance[] {
  if (review.annotation) return review.annotation.instances;
  return review.detection ? instancesFromDetection(review.detection) : [];
}

/** Which instances a page shows: the review, or what the model found. */
export const REVIEW_VERSIONS = ["review", "detection"] as const;

export type ReviewVersion = (typeof REVIEW_VERSIONS)[number];

export function shownInstances(
  review: Review,
  version: ReviewVersion,
): AnnotationInstance[] {
  if (version === "detection") {
    return review.detection ? instancesFromDetection(review.detection) : [];
  }
  return reviewInstances(review);
}
