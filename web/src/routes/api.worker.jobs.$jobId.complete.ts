import { createFileRoute } from "@tanstack/react-router";

import { completeJob } from "../server/job-store";

export const Route = createFileRoute("/api/worker/jobs/$jobId/complete")({
  server: {
    handlers: {
      POST: ({ params }) => {
        try {
          return Response.json(completeJob(params.jobId));
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
