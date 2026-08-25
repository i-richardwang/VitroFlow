import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { failJob } from "../server/job-store";

const failureSchema = z.strictObject({ error: z.string().min(1).max(2000) });

export const Route = createFileRoute("/api/worker/jobs/$jobId/fail")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const body = failureSchema.parse(await request.json());
          return Response.json(failJob(params.jobId, body.error));
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
