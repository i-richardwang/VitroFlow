import { createFileRoute } from "@tanstack/react-router";

import { storeJobResult } from "../server/job-store";

export const Route = createFileRoute(
  "/api/worker/jobs/$jobId/results/$imageId",
)({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        try {
          const job = await storeJobResult(
            params.jobId,
            params.imageId,
            await request.formData(),
          );
          return Response.json({ completedImages: job.completedImages });
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
