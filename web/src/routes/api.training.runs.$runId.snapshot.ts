import { createFileRoute } from "@tanstack/react-router";

import { versionIdSchema } from "../inference/schema";
import { snapshotForRun } from "../server/training-runs";
import {
  parseTrainingValue,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";

export const Route = createFileRoute("/api/training/runs/$runId/snapshot")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const workerId = parseTrainingValue(
            new URL(request.url).searchParams.get("workerId"),
            versionIdSchema,
            "workerId",
          );
          return Response.json(await snapshotForRun(params.runId, workerId));
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training snapshot request failed",
          );
        }
      },
    },
  },
});
