import { createFileRoute } from "@tanstack/react-router";

import {
  requestingWorker,
  workerErrorResponse,
} from "../server/transport/http/worker";

/** A token check: which enrolled worker the token belongs to. */
export const Route = createFileRoute("/api/worker/ready")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return Response.json({ workerId: await requestingWorker(request) });
        } catch (error) {
          return workerErrorResponse(error, "Worker check failed");
        }
      },
    },
  },
});
