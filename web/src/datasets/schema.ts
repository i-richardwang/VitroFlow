import { z } from "zod";

import { photoRefSchema } from "../experiments/schema";
import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";

export const DATASET_NAME_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}";
const DATASET_NAME = new RegExp(`^${DATASET_NAME_PATTERN}$`);
export const datasetIdSchema = z
  .string()
  .regex(
    DATASET_NAME,
    "Dataset names use letters, numbers, dots, dashes, and underscores",
  );

/** One dataset named at an API or route boundary. */
export const datasetRefSchema = z.strictObject({
  dataset: datasetIdSchema,
});

/** One image as a member of one dataset. */
export const datasetImageRefSchema = datasetRefSchema.extend({
  digest: imageDigestSchema,
});

export type DatasetImageRef = z.infer<typeof datasetImageRefSchema>;

/** A dataset trains one model; its images are reviewed for that model. */
export const datasetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: datasetIdSchema,
  modelId: resourceIdSchema,
});

export type Dataset = z.infer<typeof datasetSchema>;

/**
 * Experiment photographs joining a dataset. Each is named by where it was
 * taken, so the dataset files it under that filename and trains the model the
 * experiment reads with; the dataset is created for that model on first use.
 */
export const datasetPhotoAdditionSchema = z.strictObject({
  dataset: datasetIdSchema,
  photos: z.array(photoRefSchema).min(1, "No photographs to add"),
});

/**
 * An image's state within a dataset is the state of its review for the
 * dataset's model. Until a review starts, the image is unreviewed whatever
 * detections exist for it.
 */
export const IMAGE_STATES = [
  "unreviewed",
  "in_progress",
  "complete",
  "excluded",
] as const;

export type ImageState = (typeof IMAGE_STATES)[number];
