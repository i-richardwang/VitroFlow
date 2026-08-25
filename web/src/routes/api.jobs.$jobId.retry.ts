import { createFileRoute } from "@tanstack/react-router";

import { retryJob } from "../server/job-store";

export const Route = createFileRoute("/api/jobs/$jobId/retry")({
  server: {
    handlers: {
      POST: ({ params, request }) => {
        const url = new URL("/jobs", request.url);
        try {
          retryJob(params.jobId);
          url.searchParams.set("retried", params.jobId);
        } catch (error) {
          url.searchParams.set(
            "error",
            error instanceof Error ? error.message : String(error),
          );
        }
        return Response.redirect(url, 303);
      },
    },
  },
});
