import { z } from "zod";

import { versionIdSchema } from "../prelabelers/schema";

/** Dataset names double as directory names under `images/`. */
export const DATASET_NAME_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}";
export const DATASET_NAME = new RegExp(`^${DATASET_NAME_PATTERN}$`);

/** An image stem is its filename without the extension and identifies it within a dataset. */
export const IMAGE_STEM = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;

export const imageSourceSchema = z
  .string()
  .min(1)
  .refine(
    (source) =>
      source.startsWith("images/") &&
      !source.includes("\\") &&
      !source.split("/").includes(".."),
    "Image source must be a relative path under images",
  );

export const imageRefSchema = z.strictObject({
  dataset: z.string().regex(DATASET_NAME),
  stem: z.string().regex(IMAGE_STEM),
});

export type ImageRef = z.infer<typeof imageRefSchema>;

export const datasetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(DATASET_NAME),
  modelId: z.string().regex(DATASET_NAME),
  selectedPrelabelerVersionId: versionIdSchema,
});

export type Dataset = z.infer<typeof datasetSchema>;

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
