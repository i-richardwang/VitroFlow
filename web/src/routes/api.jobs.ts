import { createFileRoute } from "@tanstack/react-router";

import { createJobFromUpload } from "../server/job-upload";

export const Route = createFileRoute("/api/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const job = await createJobFromUpload(await request.formData());
          return Response.json({ created: job.id });
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
