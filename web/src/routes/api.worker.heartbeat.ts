import { createFileRoute } from "@tanstack/react-router";

import { parseWorkerJson, workerErrorResponse } from "../server/worker-http";
import { recordWorkerHeartbeat } from "../server/workers";
import { workerHeartbeatSchema } from "../workers/schema";

export const Route = createFileRoute("/api/worker/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(
            await recordWorkerHeartbeat(
              await parseWorkerJson(request, workerHeartbeatSchema),
            ),
          );
        } catch (error) {
          return workerErrorResponse(error, "Could not record heartbeat");
        }
      },
    },
  },
});
