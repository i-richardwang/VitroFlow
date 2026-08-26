import { createFileRoute } from "@tanstack/react-router";

import { retryJob } from "../server/job-store";

export const Route = createFileRoute("/api/jobs/$jobId/retry")({
  server: {
    handlers: {
      POST: ({ params }) => {
        const search = new URLSearchParams();
        try {
          retryJob(params.jobId);
          search.set("retried", params.jobId);
        } catch (error) {
          search.set(
            "error",
            error instanceof Error ? error.message : String(error),
          );
        }
        return new Response(null, {
          status: 303,
          headers: { Location: `/jobs?${search}` },
        });
      },
    },
  },
});
