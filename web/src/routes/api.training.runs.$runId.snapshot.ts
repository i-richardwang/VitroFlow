import { createFileRoute } from "@tanstack/react-router";

import { snapshotForRun } from "../server/training-runs";
import {
  parseTrainingWorkerIdentity,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";

export const Route = createFileRoute("/api/training/runs/$runId/snapshot")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const owner = parseTrainingWorkerIdentity(
            new URL(request.url).searchParams,
          );
          return Response.json(await snapshotForRun(params.runId, owner));
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
