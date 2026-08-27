import { z } from "zod";

import { fingerprintSchema, versionIdSchema } from "../inference/schema";

export const DATASET_NAME_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}";
export const DATASET_NAME = new RegExp(`^${DATASET_NAME_PATTERN}$`);

/**
 * An image is identified by the SHA-256 digest of its bytes everywhere: in
 * the database, in blob storage, in documents, and in URLs. Datasets refer to
 * images; they do not own them.
 */
export const imageDigestSchema = fingerprintSchema;

/** One image as a member of one dataset. */
export const imageRefSchema = z.strictObject({
  dataset: z.string().regex(DATASET_NAME),
  digest: imageDigestSchema,
});

export type ImageRef = z.infer<typeof imageRefSchema>;

/**
 * The photograph formats the workbench accepts. An image's extension names
 * the format its bytes declare, one canonical extension per format.
 */
export const IMAGE_EXTENSIONS = [".jpg", ".png", ".tif"] as const;

export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

export const imageExtensionSchema = z.enum(IMAGE_EXTENSIONS);

export const datasetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(DATASET_NAME),
  modelId: z.string().regex(DATASET_NAME),
  selectedModelVersionId: versionIdSchema,
});

export type Dataset = z.infer<typeof datasetSchema>;

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
