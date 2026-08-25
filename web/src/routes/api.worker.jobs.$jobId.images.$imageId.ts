import { createFileRoute } from "@tanstack/react-router";

import { readJobImage } from "../server/job-store";

export const Route = createFileRoute(
  "/api/worker/jobs/$jobId/images/$imageId",
)({
  server: {
    handlers: {
      GET: ({ params }) => {
        try {
          const image = readJobImage(params.jobId, params.imageId);
          return new Response(Uint8Array.from(image.bytes).buffer, {
            headers: {
              "Content-Type": image.contentType,
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
            },
          });
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 404 },
          );
        }
      },
    },
  },
});
