import { imageDigestSchema } from "../datasets/schema";
import { CANONICAL_IMAGE_MEDIA_TYPE } from "../images/canonical";
import { blobExists, imageBlobKey, readBlob } from "./blobs";

/**
 * Serves a photograph by digest. Every image is stored in the one canonical
 * encoding, so the bytes are the whole answer: nothing about them has to be
 * looked up, and because a digest's bytes never change every response may be
 * cached indefinitely.
 */
export function imageResponse(digest: unknown): Response {
  const parsed = imageDigestSchema.safeParse(digest);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const key = imageBlobKey(parsed.data);
  if (!blobExists(key)) return new Response("Not found", { status: 404 });
  return new Response(readBlob(key), {
    headers: {
      "Content-Type": CANONICAL_IMAGE_MEDIA_TYPE,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
