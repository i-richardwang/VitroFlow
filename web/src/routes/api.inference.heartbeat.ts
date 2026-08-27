import { createFileRoute } from "@tanstack/react-router";

import { heartbeatSchema } from "../inference/workers";
import { recordInferenceHeartbeat } from "../server/inference-worker-store";

export const Route = createFileRoute("/api/inference/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(
            recordInferenceHeartbeat(heartbeatSchema.parse(await request.json())),
          );
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 400 },
          );
        }
      },
    },
  },
});
