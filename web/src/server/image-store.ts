import { transaction } from "../db/client";
import { images } from "../db/schema";
import { MAX_SOURCE_IMAGE_BYTES } from "../images/canonical";
import { imageBlobKey, putImmutableBlob } from "./blobs";
import { canonicalize, ImageSourceError } from "./image-ingest";
import { lockImage } from "./image-lock";

/** A canonical image held independently of every dataset. */
export interface StoredImage {
  digest: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Stores one canonical image without assigning it to a dataset. The
 * digest lock is also used by Blob collection: after the immutable object is
 * visible, a committed Image row either roots it or a later sweep removes it.
 */
export async function storeImage(source: Uint8Array): Promise<StoredImage> {
  if (source.byteLength === 0) throw new ImageSourceError("The image is empty");
  if (source.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new ImageSourceError("The image exceeds 64 MiB");
  }
  const { digest, bytes, width, height } = await canonicalize(source);
  const receivedAt = new Date();
  await transaction(async (tx) => {
    await lockImage(digest, tx);
    await tx
      .insert(images)
      .values({
        id: digest,
        width,
        height,
        bytes: bytes.byteLength,
        receivedAt,
      })
      .onConflictDoUpdate({ target: images.id, set: { receivedAt } });
    await putImmutableBlob(imageBlobKey(digest), bytes);
  });
  return { digest, width, height, bytes: bytes.byteLength };
}
