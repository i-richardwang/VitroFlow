import { createFileRoute } from "@tanstack/react-router";

import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { recordWorkerHeartbeat } from "../server/workers/public";
import { workerReportSchema } from "../domain/workers/schema";

export const Route = createFileRoute("/api/worker/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(
            await recordWorkerHeartbeat(
              await parseWorkerSessionJson(request, workerReportSchema),
            ),
          );
        } catch (error) {
          return workerErrorResponse(error, "Could not record heartbeat");
        }
      },
    },
  },
});
