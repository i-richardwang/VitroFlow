import { and, eq } from "drizzle-orm";

import { transaction } from "../db/client";
import { datasetImages, images } from "../db/schema";
import { DATASET_NAME } from "../datasets/schema";
import { MAX_SOURCE_IMAGE_BYTES } from "../images/canonical";
import { blobExists, imageBlobKey, writeBlob } from "./blobs";
import {
  ensureDataset,
  membershipQuery,
  toDatasetImage,
  type DatasetImage,
} from "./datasets";
import { canonicalize } from "./image-ingest";
import { lockImage } from "./image-lock";

export interface UploadResult {
  /** The membership the photograph has in the dataset. */
  image: DatasetImage;
  /** Whether this upload is what created it. */
  added: boolean;
}

export interface ImageSource {
  filename: string;
  bytes: Uint8Array;
}

function validate(datasetId: string, source: ImageSource): void {
  if (!DATASET_NAME.test(datasetId)) {
    throw new Error(
      "Dataset names use letters, numbers, dots, dashes, and underscores",
    );
  }
  const { filename, bytes } = source;
  if (
    !filename ||
    filename.length > 255 ||
    filename === "." ||
    filename === ".." ||
    /[\\/\0]/.test(filename)
  ) {
    throw new Error(`Invalid image filename: ${filename}`);
  }
  if (bytes.byteLength === 0) {
    throw new Error(`Image is empty: ${filename}`);
  }
  if (bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image exceeds 64 MiB: ${filename}`);
  }
}

/**
 * Adds one photograph to a dataset. An image is its canonical bytes: two
 * sources that encode to the same photograph are one image, and adding it to a
 * dataset it is already in changes nothing. The bytes are written under the
 * lock that decides whether they may be collected, so no row ever outlives its
 * blob.
 *
 * A photograph is the unit an upload succeeds or fails in. Nothing relates one
 * to the next — each has its own identity and its own membership — so a source
 * that will not decode costs only itself.
 */
export async function addImage(
  datasetId: string,
  source: ImageSource,
): Promise<UploadResult> {
  validate(datasetId, source);
  const { filename } = source;
  const { digest, bytes, width, height } = await canonicalize(
    source.bytes,
  ).catch((cause: unknown) => {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${filename}: ${reason}`);
  });
  const uploadedAt = new Date();
  return transaction(async (tx) => {
    await ensureDataset(datasetId, tx);
    await lockImage(digest, tx);
    await tx
      .insert(images)
      .values({
        id: digest,
        width,
        height,
        bytes: bytes.byteLength,
        uploadedAt,
      })
      .onConflictDoNothing();
    const key = imageBlobKey(digest);
    if (!blobExists(key)) writeBlob(key, bytes);
    const [membership] = await tx
      .insert(datasetImages)
      .values({
        datasetId,
        imageId: digest,
        filename,
        addedAt: uploadedAt,
      })
      .onConflictDoNothing()
      .returning({ imageId: datasetImages.imageId });
    const [row] = await membershipQuery(tx).where(
      and(
        eq(datasetImages.datasetId, datasetId),
        eq(datasetImages.imageId, digest),
      ),
    );
    if (!row) throw new Error(`Image ${digest} was not added to ${datasetId}`);
    return { image: toDatasetImage(row), added: membership != null };
  });
}
