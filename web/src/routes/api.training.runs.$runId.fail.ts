import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { versionIdSchema } from "../inference/schema";
import { failTrainingRun } from "../server/training-runs";

const bodySchema = z.strictObject({
  workerId: versionIdSchema,
  error: z.string().min(1).max(2000),
});

export const Route = createFileRoute("/api/training/runs/$runId/fail")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const body = bodySchema.parse(await request.json());
          return Response.json(
            await failTrainingRun(params.runId, body.workerId, body.error),
          );
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            {
              status: 409,
            },
          );
        }
      },
    },
  },
});
