import { createHash } from "node:crypto";
import * as path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";

import { transaction } from "../db/client";
import { datasets, images } from "../db/schema";
import { DATASET_NAME, IMAGE_STEM } from "../datasets/schema";
import { blobExists, imageBlobKey, writeBlob } from "./blobs";
import { ensureDataset, toDatasetImage, type DatasetImage } from "./datasets";
import { CONTENT_TYPES } from "./image-files";

const MAX_IMAGES_PER_UPLOAD = 100;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

function stemOf(filename: string): string {
  return filename.slice(0, -path.extname(filename).length);
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
  const seen = new Set<string>();
  for (const file of files) {
    const filename = file.name;
    if (path.basename(filename) !== filename || !filename) {
      throw new Error(`Invalid image filename: ${filename}`);
    }
    if (!(path.extname(filename).toLowerCase() in CONTENT_TYPES)) {
      throw new Error(`Unsupported image type: ${filename}`);
    }
    const stem = stemOf(filename);
    if (!IMAGE_STEM.test(stem)) {
      throw new Error(`Invalid image name: ${filename}`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Image exceeds 64 MiB: ${filename}`);
    }
    const key = stem.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate image in upload: ${filename}`);
    }
    seen.add(key);
  }
}

/**
 * Adds photographs to a dataset. Stems identify images case-insensitively, so
 * a filename whose stem already exists is rejected regardless of extension,
 * and the whole batch is validated before anything is written. Bytes are
 * immutable and addressed by digest; an unreferenced blob is harmless and may
 * be collected later, while deleting one during rollback could race another
 * upload that has just committed the same contents.
 */
export async function addImages(
  datasetId: string,
  files: File[],
): Promise<DatasetImage[]> {
  validateBatch(datasetId, files);
  const uploadedAt = new Date();
  const prepared: Array<{
    row: typeof images.$inferInsert;
    bytes: Uint8Array;
  }> = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    prepared.push({
      bytes,
      row: {
        datasetId,
        stem: stemOf(file.name),
        extension: path.extname(file.name).toLowerCase(),
        bytes: bytes.byteLength,
        digest,
        uploadedAt,
      },
    });
  }
  return transaction(async (tx) => {
    await ensureDataset(datasetId, tx);
    await tx
      .select({ id: datasets.id })
      .from(datasets)
      .where(eq(datasets.id, datasetId))
      .for("update");
    const rows = prepared.map(({ row }) => row);
    const [taken] = await tx
      .select({ stem: images.stem })
      .from(images)
      .where(
        and(
          eq(images.datasetId, datasetId),
          inArray(
            sql`lower(${images.stem})`,
            rows.map((row) => row.stem.toLocaleLowerCase()),
          ),
        ),
      )
      .limit(1);
    if (taken) throw new Error(`Image already in dataset: ${taken.stem}`);
    for (const { row, bytes } of prepared) {
      const key = imageBlobKey(row.digest);
      if (!blobExists(key)) writeBlob(key, bytes);
    }
    const inserted = await tx.insert(images).values(rows).returning();
    return inserted.map(toDatasetImage);
  });
}
