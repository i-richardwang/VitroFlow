import { transaction, type Executor } from "../db/client";
import { images } from "../db/schema";
import { MAX_IMAGE_BYTES } from "../images/canonical";
import { contentDigest, imageBlobKey, putImmutableBlob } from "./blobs";
import {
  canonicalImageSize,
  canonicalize,
  ImageSourceError,
  type CanonicalImage,
} from "./image-ingest";
import { lockImage } from "./image-lock";

/** A canonical image held independently of every dataset. */
export interface StoredImage {
  digest: string;
  width: number;
  height: number;
  bytes: number;
}

function assertStorable(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new ImageSourceError("The image is empty");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageSourceError("The image exceeds 64 MiB");
  }
}

/**
 * Records a canonical image without assigning it to a dataset. The digest
 * lock is also used by Blob collection: after the immutable object is
 * visible, a committed Image row either roots it or a later sweep removes it.
 */
async function recordImage(
  image: CanonicalImage,
  tx: Executor,
): Promise<StoredImage> {
  const { digest, bytes, width, height } = image;
  await lockImage(digest, tx);
  await tx
    .insert(images)
    .values({
      id: digest,
      width,
      height,
      bytes: bytes.byteLength,
      receivedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: images.id,
      set: { receivedAt: new Date() },
    });
  await putImmutableBlob(imageBlobKey(digest), bytes);
  return { digest, width, height, bytes: bytes.byteLength };
}

/** Stores the canonical image a source encodes. */
export async function storeImage(source: Uint8Array): Promise<StoredImage> {
  assertStorable(source);
  const image = await canonicalize(source);
  assertStorable(image.bytes);
  return transaction((tx) => recordImage(image, tx));
}

/**
 * Stores bytes that are already a canonical image, as another workbench
 * exported them. They enter untouched, so the digest they were addressed by
 * there, and every annotation addressed by it, holds here too. Bytes that do
 * not hash to `digest` or are not the canonical encoding are refused.
 */
export async function storeCanonicalImage(
  digest: string,
  bytes: Uint8Array,
): Promise<StoredImage> {
  assertStorable(bytes);
  if (contentDigest(bytes) !== digest) {
    throw new ImageSourceError(`The bytes do not hash to ${digest}`);
  }
  const { width, height } = await canonicalImageSize(bytes);
  return transaction((tx) => recordImage({ digest, bytes, width, height }, tx));
}
