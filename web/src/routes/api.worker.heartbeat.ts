import { createFileRoute } from "@tanstack/react-router";

import { recordHeartbeat } from "../server/worker-store";
import { heartbeatSchema } from "../workers/schema";

export const Route = createFileRoute("/api/worker/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(
            recordHeartbeat(heartbeatSchema.parse(await request.json())),
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
