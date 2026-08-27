import { createFileRoute } from "@tanstack/react-router";

import { snapshotForRun } from "../server/training-runs";

export const Route = createFileRoute("/api/training/runs/$runId/snapshot")({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        try {
          const workerId = new URL(request.url).searchParams.get("workerId");
          if (!workerId) return new Response("workerId is required", { status: 400 });
          return Response.json(snapshotForRun(params.runId, workerId));
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), {
            status: 409,
          });
        }
      },
    },
  },
});
