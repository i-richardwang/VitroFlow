import { eq } from "drizzle-orm";

import { database } from "../db/client";
import { images } from "../db/schema";
import {
  imageDigestSchema,
  imageExtensionSchema,
  type ImageExtension,
} from "../datasets/schema";
import { imageBlobKey, readBlob } from "./blobs";

const CONTENT_TYPES: Record<ImageExtension, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
};

/**
 * Serves a photograph by digest. The bytes behind a digest never change, so
 * every response may be cached indefinitely.
 */
export async function imageResponse(digest: unknown): Promise<Response> {
  const parsed = imageDigestSchema.safeParse(digest);
  const db = await database();
  const [image] = parsed.success
    ? await db
        .select({ extension: images.extension })
        .from(images)
        .where(eq(images.id, parsed.data))
    : [];
  if (!parsed.success || !image) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(readBlob(imageBlobKey(parsed.data)), {
    headers: {
      "Content-Type":
        CONTENT_TYPES[imageExtensionSchema.parse(image.extension)],
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
