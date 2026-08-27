import { createFileRoute } from "@tanstack/react-router";

import { imageResponse } from "../server/image-files";
import { snapshotForRun } from "../server/training-runs";

export const Route = createFileRoute(
  "/api/training/runs/$runId/images/$digest",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const workerId = new URL(request.url).searchParams.get("workerId");
          if (!workerId)
            return new Response("workerId is required", { status: 400 });
          const snapshot = await snapshotForRun(params.runId, workerId);
          if (!snapshot.images.some((image) => image.digest === params.digest))
            return new Response("Not found", { status: 404 });
          return imageResponse(params.digest);
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 409 },
          );
        }
      },
    },
  },
});
