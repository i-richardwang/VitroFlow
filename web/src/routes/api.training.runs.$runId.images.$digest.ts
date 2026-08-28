import { createFileRoute } from "@tanstack/react-router";

import { versionIdSchema } from "../inference/schema";
import { imageResponse } from "../server/image-files";
import { snapshotForRun } from "../server/training-runs";
import {
  parseTrainingValue,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";

export const Route = createFileRoute(
  "/api/training/runs/$runId/images/$digest",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const workerId = parseTrainingValue(
            new URL(request.url).searchParams.get("workerId"),
            versionIdSchema,
            "workerId",
          );
          const snapshot = await snapshotForRun(params.runId, workerId);
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
