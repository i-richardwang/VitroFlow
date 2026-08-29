import { createFileRoute } from "@tanstack/react-router";

import { MAX_SOURCE_IMAGE_BYTES } from "../images/canonical";
import { ImageSourceError } from "../server/image-ingest";
import { storeImage } from "../server/image-store";

function failed(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Stores one photograph. The request is its bytes and nothing else: a
 * photograph is identified by what it contains, and the name it is filed under
 * belongs to the dataset that claims it, not to the image.
 */
export const Route = createFileRoute("/api/images")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declaredLength = Number(request.headers.get("content-length"));
        if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
          return failed("Image Content-Length is required", 411);
        }
        if (declaredLength > MAX_SOURCE_IMAGE_BYTES) {
          return failed("Image exceeds 64 MiB", 413);
        }
        try {
          const source = new Uint8Array(await request.arrayBuffer());
          if (source.byteLength !== declaredLength) {
            return failed("Image length differs from Content-Length", 400);
          }
          const stored = await storeImage(source);
          return Response.json({ digest: stored.digest });
        } catch (error) {
          if (error instanceof ImageSourceError) {
            return failed(error.message, 400);
          }
          console.error(
            `Store image failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return failed("Could not store image", 500);
        }
      },
    },
  },
});
