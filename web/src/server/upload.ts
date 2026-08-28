import * as path from "node:path";
import { and, eq, inArray } from "drizzle-orm";

import { transaction } from "../db/client";
import { datasetImages, images } from "../db/schema";
import { DATASET_NAME } from "../datasets/schema";
import { MAX_SOURCE_IMAGE_BYTES } from "../images/canonical";
import { blobExists, imageBlobKey, writeBlob } from "./blobs";
import {
  ensureDataset,
  membershipOrder,
  membershipQuery,
  toDatasetImage,
  type DatasetImage,
} from "./datasets";
import { canonicalize, type CanonicalImage } from "./image-ingest";
import { lockImage } from "./image-lock";

/** Photographs one request ingests, bounded by the seconds each one costs. */
const MAX_IMAGES_PER_UPLOAD = 20;
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface UploadResult {
  /** Memberships this upload created. */
  added: DatasetImage[];
  /** Memberships that already existed for the uploaded photographs. */
  existing: DatasetImage[];
}

interface Upload extends CanonicalImage {
  filename: string;
}

function validateBatch(datasetId: string, files: File[]): void {
  if (!DATASET_NAME.test(datasetId)) {
    throw new Error(
      "Dataset names use letters, numbers, dots, dashes, and underscores",
    );
  }
  if (files.length === 0) {
    throw new Error("Select at least one image");
  }
  if (files.length > MAX_IMAGES_PER_UPLOAD) {
    throw new Error(`Upload at most ${MAX_IMAGES_PER_UPLOAD} images at a time`);
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_BYTES) {
    throw new Error("Image batch exceeds 512 MiB");
  }
  for (const file of files) {
    const filename = file.name;
    if (path.basename(filename) !== filename || !filename) {
      throw new Error(`Invalid image filename: ${filename}`);
    }
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      throw new Error(`Image exceeds 64 MiB: ${filename}`);
    }
  }
}

/**
 * The photographs the sources encode, by digest. Ingestion is deliberately
 * sequential: decoding one bounded source at a time keeps memory independent
 * of the number of files a request carries.
 */
async function ingest(files: File[]): Promise<Map<string, Upload>> {
  const uploads = new Map<string, Upload>();
  for (const file of files) {
    const source = new Uint8Array(await file.arrayBuffer());
    try {
      const image = await canonicalize(source);
      uploads.set(image.digest, { ...image, filename: file.name });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`${file.name}: ${reason}`);
    }
  }
  return uploads;
}

/**
 * Adds photographs to a dataset. An image is its canonical bytes: two sources
 * that encode to the same photograph are one image, and adding it to a dataset
 * it is already in changes nothing. The whole batch is ingested before
 * anything is written, and each image's bytes are written under the lock that
 * decides whether they may be collected, so no row ever outlives its blob.
 */
export async function addImages(
  datasetId: string,
  files: File[],
): Promise<UploadResult> {
  validateBatch(datasetId, files);
  const uploadedAt = new Date();
  const uploads = await ingest(files);
  const digests = [...uploads.keys()].sort();
  return transaction(async (tx) => {
    await ensureDataset(datasetId, tx);
    for (const digest of digests) await lockImage(digest, tx);
    await tx
      .insert(images)
      .values(
        digests.map((id) => {
          const { bytes, width, height } = uploads.get(id)!;
          return { id, width, height, bytes: bytes.byteLength, uploadedAt };
        }),
      )
      .onConflictDoNothing();
    for (const digest of digests) {
      const key = imageBlobKey(digest);
      if (!blobExists(key)) writeBlob(key, uploads.get(digest)!.bytes);
    }
    const inserted = await tx
      .insert(datasetImages)
      .values(
        digests.map((digest) => ({
          datasetId,
          imageId: digest,
          filename: uploads.get(digest)!.filename,
          addedAt: uploadedAt,
        })),
      )
      .onConflictDoNothing()
      .returning({ imageId: datasetImages.imageId });
    const added = new Set(inserted.map((row) => row.imageId));
    const members = (
      await membershipQuery(tx)
        .where(
          and(
            eq(datasetImages.datasetId, datasetId),
            inArray(datasetImages.imageId, digests),
          ),
        )
        .orderBy(...membershipOrder())
    ).map(toDatasetImage);
    return {
      added: members.filter((image) => added.has(image.digest)),
      existing: members.filter((image) => !added.has(image.digest)),
    };
  });
}
