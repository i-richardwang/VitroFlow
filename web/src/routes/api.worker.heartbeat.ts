import { createFileRoute } from "@tanstack/react-router";

import {
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { recordWorkerHeartbeat } from "../server/workers/public";
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
