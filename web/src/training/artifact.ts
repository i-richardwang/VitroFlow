/** Published weights are admitted explicitly before multipart parsing. */
export const MAX_TRAINING_WEIGHTS_BYTES = 512 * 1024 * 1024;

/** `inference.json` is metadata, not an unbounded auxiliary artifact. */
export const MAX_TRAINING_MANIFEST_BYTES = 1024 * 1024;

/** Allows the two parts plus their multipart headers. */
export const MAX_TRAINING_ARTIFACT_REQUEST_BYTES =
  MAX_TRAINING_WEIGHTS_BYTES + MAX_TRAINING_MANIFEST_BYTES + 1024 * 1024;
