import { eq } from "drizzle-orm";

import { transaction } from "../db/client";
import { images } from "../db/schema";
import { imageDigestSchema } from "../datasets/schema";
import { imageBlobKey, listBlobs, removeBlob } from "./blobs";
import { lockImage } from "./image-lock";

/**
 * Removes the bytes of images no row refers to any more. Removal from a
 * dataset only ever touches rows; bytes outlive their last reference until
 * this runs. Each digest is decided under the same lock uploads take, so a
 * blob is never removed underneath an upload that is about to reference it.
 */
export async function collectUnreferencedImages(): Promise<string[]> {
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
