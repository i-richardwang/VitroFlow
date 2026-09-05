import { createFileRoute } from "@tanstack/react-router";

import { snapshotForRun } from "../server/training-runs";
import {
  parseWorkerIdentity,
  workerErrorResponse,
} from "../server/worker-http";

export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/snapshot",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const owner = parseWorkerIdentity(new URL(request.url).searchParams);
          return Response.json(await snapshotForRun(params.runId, owner));
        } catch (error) {
          return workerErrorResponse(error, "Training snapshot request failed");
        }
      },
    },
  },
});
