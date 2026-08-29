import { z } from "zod";

import { fingerprintSchema, versionIdSchema } from "../inference/schema";

export const DATASET_NAME_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}";
export const DATASET_NAME = new RegExp(`^${DATASET_NAME_PATTERN}$`);
export const datasetIdSchema = z
  .string()
  .regex(
    DATASET_NAME,
    "Dataset names use letters, numbers, dots, dashes, and underscores",
  );

/**
 * An image is identified by the SHA-256 digest of its bytes everywhere: in
 * the database, in blob storage, in documents, and in URLs. Datasets refer to
 * images; they do not own them.
 */
export const imageDigestSchema = fingerprintSchema;

/** One image as a member of one dataset. */
export const imageRefSchema = z.strictObject({
  dataset: datasetIdSchema,
  digest: imageDigestSchema,
});

export type ImageRef = z.infer<typeof imageRefSchema>;

export const datasetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: datasetIdSchema,
  modelId: datasetIdSchema,
  selectedModelVersionId: versionIdSchema,
});

export type Dataset = z.infer<typeof datasetSchema>;

const imageFilenameSchema = z
  .string()
  .min(1, "Invalid image filename")
  .max(255, "Invalid image filename")
  .refine(
    (filename) =>
      filename !== "." && filename !== ".." && !/[\\/\0]/.test(filename),
    "Invalid image filename",
  );

/** Stored photographs one dataset claims under its own filenames. */
export const imageClaimRequestSchema = z.strictObject({
  dataset: datasetIdSchema,
  images: z
    .array(
      z.strictObject({
        digest: imageDigestSchema,
        filename: imageFilenameSchema,
      }),
    )
    .min(1, "No images to claim"),
});

export type ImageClaimRequest = z.infer<typeof imageClaimRequestSchema>;

/**
 * An image's state within a dataset follows from the documents attached to
 * it there: a worker's prelabel, then a reviewer's label.
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
