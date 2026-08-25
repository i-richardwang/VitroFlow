import { createFileRoute } from "@tanstack/react-router";

import { claimNextJob } from "../server/job-store";

export const Route = createFileRoute("/api/worker/jobs/claim")({
  server: {
    handlers: {
      POST: () => {
        const job = claimNextJob();
        return job
          ? Response.json(job)
          : new Response(null, { status: 204 });
      },
    },
  },
});
