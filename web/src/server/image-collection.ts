import { and, asc, eq, lte, sql } from "drizzle-orm";

import { database, transaction } from "../db/client";
import {
  datasetImages,
  datasetSnapshotImages,
  experimentPhotos,
  images,
} from "../db/schema";
import { imageDigestSchema } from "../datasets/schema";
import { imageBlobKey, listBlobs, removeBlob } from "./blobs";
import { lockImage } from "./image-lock";

/**
 * How long a photograph nobody has claimed is kept. Bytes are stored before
 * the dataset they will join is chosen, so the period covers a person filling
 * in the rest of the form, changing their mind, and coming back to it.
 */
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/** No dataset, snapshot, or experiment refers to the image. */
function unclaimed() {
  return sql`not exists (select 1 from ${datasetImages} where ${datasetImages.imageId} = ${images.id})
    and not exists (select 1 from ${datasetSnapshotImages} where ${datasetSnapshotImages.imageId} = ${images.id})
    and not exists (select 1 from ${experimentPhotos} where ${experimentPhotos.imageId} = ${images.id})`;
}

/**
 * Forgets expired images nothing refers to. This phase only commits database
 * state: leaving their immutable objects behind is safe, and the Blob sweep
 * below removes them after the rows are durably absent.
 */
async function forgetExpiredImages(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_MS);
  const candidates = await (
    await database()
  )
    .select({ id: images.id })
    .from(images)
    .where(and(lte(images.receivedAt, cutoff), unclaimed()))
    .orderBy(asc(images.receivedAt), asc(images.id));
  for (const { id } of candidates) {
    await transaction(async (tx) => {
      await lockImage(id, tx);
      await tx
        .delete(images)
        .where(
          and(eq(images.id, id), lte(images.receivedAt, cutoff), unclaimed()),
        );
    });
  }
}

/**
 * Removes image objects with no committed Image row. The digest lock is shared
 * with storage and claims: a concurrent store either commits its row first and
 * roots the object, or rolls back before this check and leaves it collectible.
 * This transaction changes no database state, so an object deletion never has
 * a database mutation that would need to roll back with it.
 */
async function sweepImageBlobs(): Promise<string[]> {
  const collected: string[] = [];
  for (const key of await listBlobs("images/")) {
    const parsed = imageDigestSchema.safeParse(key.split("/").at(-1));
    if (!parsed.success || key !== imageBlobKey(parsed.data)) continue;
    const digest = parsed.data;
    const removed = await transaction(async (tx) => {
      await lockImage(digest, tx);
      const [row] = await tx
        .select({ id: images.id })
        .from(images)
        .where(eq(images.id, digest));
      if (row) return false;
      await removeBlob(key);
      return true;
    });
    if (removed) collected.push(digest);
  }
  return collected;
}

/** Expires unclaimed Image rows, then sweeps every Blob no row roots. */
export async function collectImages(now: Date = new Date()): Promise<string[]> {
  await forgetExpiredImages(now);
  return sweepImageBlobs();
}
