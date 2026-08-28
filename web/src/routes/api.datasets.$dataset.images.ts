import { createFileRoute } from "@tanstack/react-router";

import { MAX_SOURCE_IMAGE_BYTES } from "../images/canonical";
import { addImage } from "../server/upload";

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/datasets/$dataset/images")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const filename = new URL(request.url).searchParams.get("filename");
        if (!filename) return error("Image filename is required", 400);
        const declaredLength = Number(request.headers.get("content-length"));
        if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
          return error("Image Content-Length is required", 411);
        }
        if (declaredLength > MAX_SOURCE_IMAGE_BYTES) {
          return error("Image exceeds 64 MiB", 413);
        }
        try {
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (bytes.byteLength !== declaredLength) {
            return error("Image length differs from Content-Length", 400);
          }
          const { image, added } = await addImage(params.dataset, {
            filename,
            bytes,
          });
          return Response.json({ digest: image.digest, added });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
      },
    },
  },
});
