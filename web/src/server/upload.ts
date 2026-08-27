import * as path from "node:path";
import { and, eq, inArray } from "drizzle-orm";

import { transaction } from "../db/client";
import { datasetImages, images } from "../db/schema";
import { DATASET_NAME } from "../datasets/schema";
import { blobExists, contentDigest, imageBlobKey, writeBlob } from "./blobs";
import {
  ensureDataset,
  membershipOrder,
  membershipQuery,
  toDatasetImage,
  type DatasetImage,
} from "./datasets";
import { imageFormat } from "./image-format";
import { lockImage } from "./image-lock";

const MAX_IMAGES_PER_UPLOAD = 100;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface UploadResult {
  /** Memberships this upload created. */
  added: DatasetImage[];
  /** Memberships that already existed for the uploaded bytes. */
  existing: DatasetImage[];
}

interface Upload {
  bytes: Uint8Array;
  extension: NonNullable<ReturnType<typeof imageFormat>>;
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
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Image exceeds 64 MiB: ${filename}`);
    }
  }
}

/** The uploads by digest; the format comes from the bytes, never the name. */
async function readUploads(files: File[]): Promise<Map<string, Upload>> {
  const uploads = new Map<string, Upload>();
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = imageFormat(bytes);
    if (!extension) throw new Error(`Unsupported image content: ${file.name}`);
    uploads.set(contentDigest(bytes), {
      bytes,
      extension,
      filename: file.name,
    });
  }
  return uploads;
}

/**
 * Adds photographs to a dataset. An image is its bytes: the same bytes
 * uploaded twice, under any names, are one image, and adding it to a dataset
 * it is already in changes nothing. The whole batch is validated before
 * anything is written.
 */
export async function addImages(
  datasetId: string,
  files: File[],
): Promise<UploadResult> {
  validateBatch(datasetId, files);
  const uploadedAt = new Date();
  const uploads = await readUploads(files);
  const digests = [...uploads.keys()].sort();
  return transaction(async (tx) => {
    await ensureDataset(datasetId, tx);
    for (const digest of digests) await lockImage(digest, tx);
    await tx
      .insert(images)
      .values(
        digests.map((id) => {
          const { bytes, extension } = uploads.get(id)!;
          return { id, extension, bytes: bytes.byteLength, uploadedAt };
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
