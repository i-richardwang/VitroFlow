import { createFileRoute } from "@tanstack/react-router";

import { heartbeatSchema } from "../inference/workers";
import {
  inferenceWorkerErrorResponse,
  parseInferenceJson,
} from "../server/inference-worker-http";
import { recordInferenceHeartbeat } from "../server/inference-worker-store";

export const Route = createFileRoute("/api/inference/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(
            await recordInferenceHeartbeat(
              await parseInferenceJson(request, heartbeatSchema),
            ),
          );
        } catch (error) {
          return inferenceWorkerErrorResponse(
            error,
            "Could not record inference heartbeat",
          );
        }
      },
    },
  },
});
