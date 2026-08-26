import { createFileRoute } from "@tanstack/react-router";

import { retryJob } from "../server/job-store";

export const Route = createFileRoute("/api/jobs/$jobId/retry")({
  server: {
    handlers: {
      POST: ({ params }) => {
        try {
          retryJob(params.jobId);
          return Response.json({ retried: params.jobId });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
      },
    },
  },
});
