import { createFileRoute } from "@tanstack/react-router";

import { recordTrainingHeartbeat } from "../server/training-worker-store";
import { trainingWorkerHeartbeatSchema } from "../training/workers";

export const Route = createFileRoute("/api/training/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(
            recordTrainingHeartbeat(
              trainingWorkerHeartbeatSchema.parse(await request.json()),
            ),
          );
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), {
            status: 400,
          });
        }
      },
    },
  },
});
