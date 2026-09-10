import { imageDigestSchema } from "../../../domain/images/schema";
import { CANONICAL_IMAGE_MEDIA_TYPE } from "../../../domain/images/canonical";
import { imageBlobKey } from "../../images/public";
import { openBlob } from "../../infra/blobs/store";

/**
 * Serves an image by digest. Every image is stored in the one canonical
 * encoding, so the bytes are the whole answer: nothing about them has to be
 * looked up, and because a digest's bytes never change every response may be
 * cached indefinitely. The bytes are streamed from the store, so a response
 * costs the same whatever the image weighs.
 */
export async function imageResponse(digest: unknown): Promise<Response> {
  const parsed = imageDigestSchema.safeParse(digest);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const blob = await openBlob(imageBlobKey(parsed.data));
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(blob.stream, {
    headers: {
      "Content-Type": CANONICAL_IMAGE_MEDIA_TYPE,
      "Content-Length": String(blob.size),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
