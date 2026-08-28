import { createFileRoute } from "@tanstack/react-router";

import { recordTrainingHeartbeat } from "../server/training-worker-store";
import {
  parseTrainingJson,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";
import { trainingWorkerHeartbeatSchema } from "../training/workers";

export const Route = createFileRoute("/api/training/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(
            await recordTrainingHeartbeat(
              await parseTrainingJson(request, trainingWorkerHeartbeatSchema),
            ),
          );
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training worker heartbeat failed",
          );
        }
      },
    },
  },
});
