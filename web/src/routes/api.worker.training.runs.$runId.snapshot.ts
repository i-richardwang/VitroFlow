import { createFileRoute } from "@tanstack/react-router";

import { snapshotForRun } from "../server/training/public";
import {
  parseWorkerQuery,
  workerErrorResponse,
} from "../server/transport/http/worker";

export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/snapshot",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const owner = await parseWorkerQuery(request);
          return Response.json(await snapshotForRun(params.runId, owner));
        } catch (error) {
          return workerErrorResponse(error, "Training snapshot request failed");
        }
      },
    },
  },
});
