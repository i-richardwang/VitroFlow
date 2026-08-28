import { createFileRoute } from "@tanstack/react-router";

import { imageResponse } from "../server/image-files";
import { snapshotForRun } from "../server/training-runs";
import {
  parseTrainingWorkerIdentity,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";

export const Route = createFileRoute(
  "/api/training/runs/$runId/images/$digest",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const owner = parseTrainingWorkerIdentity(
            new URL(request.url).searchParams,
          );
          const snapshot = await snapshotForRun(params.runId, owner);
          if (!snapshot.images.some((image) => image.digest === params.digest))
            return new Response("Not found", { status: 404 });
          return imageResponse(params.digest);
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training image request failed",
          );
        }
      },
    },
  },
});
