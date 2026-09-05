import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { failTrainingRun } from "../server/training-runs";
import { parseWorkerJson, workerErrorResponse } from "../server/worker-http";
import { workerIdentitySchema } from "../workers/schema";

const bodySchema = workerIdentitySchema.extend({
  error: z.string().min(1).max(2000),
});

export const Route = createFileRoute("/api/worker/training/runs/$runId/fail")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const body = await parseWorkerJson(request, bodySchema);
          return Response.json(
            await failTrainingRun(
              params.runId,
              { workerId: body.workerId, sessionId: body.sessionId },
              body.error,
            ),
          );
        } catch (error) {
          return workerErrorResponse(
            error,
            "Training run failure report failed",
          );
        }
      },
    },
  },
});
