import { z } from "zod";

/** Dataset names double as directory names under `images/`. */
export const DATASET_NAME_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}";
export const DATASET_NAME = new RegExp(`^${DATASET_NAME_PATTERN}$`);

/** An image stem is its filename without the extension and identifies it within a dataset. */
export const IMAGE_STEM = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;

export const imageRefSchema = z.strictObject({
  dataset: z.string().regex(DATASET_NAME),
  stem: z.string().regex(IMAGE_STEM),
});

export type ImageRef = z.infer<typeof imageRefSchema>;

/**
 * Everything the workbench knows about an image follows from which files
 * exist for it: a prelabel from a worker, then a label from a reviewer.
 */
export const IMAGE_STATES = [
  "pending",
  "failed",
  "prelabeled",
  "in_progress",
  "complete",
  "excluded",
] as const;

export type ImageState = (typeof IMAGE_STATES)[number];
