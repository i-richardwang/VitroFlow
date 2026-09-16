import { z } from "zod";

import {
  annotationActivitySchema,
  annotationProposalSchema,
} from "../annotation-runs/schema";
import { detectionResultSchema } from "../detection/schema";
import { instancesFromDetection } from "./detection";
import {
  annotationRefSchema,
  annotationSchema,
  type AnnotationInstance,
} from "./schema";

/**
 * One image as it is read for one model, wherever the image is shown.
 *
 * Three readings can exist, and they rank: `annotation` is what a reviewer
 * decided, `proposal` is what an AI agent drew, `detection` is what the
 * model's newest version found. A reviewer's decision outranks the agent,
 * and the agent outranks the detector. Each is looked up on its own; the
 * ranking decides which one an image reads by. `activity` is the agent
 * still at work on the image, or its last failure.
 */
export const reviewSchema = z.strictObject({
  ref: annotationRefSchema,
  filename: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  detection: detectionResultSchema.nullable(),
  proposal: annotationProposalSchema.nullable(),
  annotation: annotationSchema.nullable(),
  activity: annotationActivitySchema.nullable(),
});

export type Review = z.infer<typeof reviewSchema>;

/** Where an image's boxes can come from, best first. */
export const REVIEW_SOURCES = ["review", "proposal", "detection"] as const;

export type ReviewSource = (typeof REVIEW_SOURCES)[number];

/** The instances one source holds, or null when the image has no such reading. */
export function sourceInstances(
  review: Review,
  source: ReviewSource,
): AnnotationInstance[] | null {
  switch (source) {
    case "review":
      return review.annotation?.instances ?? null;
    case "proposal":
      return review.proposal?.document.instances ?? null;
    case "detection":
      return review.detection ? instancesFromDetection(review.detection) : null;
  }
}

/** The sources this image has, best first. */
export function availableSources(review: Review): ReviewSource[] {
  return REVIEW_SOURCES.filter(
    (source) => sourceInstances(review, source) !== null,
  );
}

/** The source an image reads by: the best it has. */
export function readingSource(review: Review): ReviewSource | null {
  return availableSources(review)[0] ?? null;
}

/**
 * The instances of the review: those of its best source. An image nothing
 * has read begins from none, which is how a reviewer counts for a model that
 * has never been trained.
 */
export function reviewInstances(review: Review): AnnotationInstance[] {
  const source = readingSource(review);
  return source ? (sourceInstances(review, source) ?? []) : [];
}

/** Which instances a page shows: the source asked for, if the image has it. */
export function shownInstances(
  review: Review,
  source: ReviewSource | undefined,
): AnnotationInstance[] {
  return (source && sourceInstances(review, source)) ?? reviewInstances(review);
}

/** Whether an agent is still working on the image. */
export function agentBusy(review: Review): boolean {
  return review.activity !== null && review.activity.status !== "failed";
}
