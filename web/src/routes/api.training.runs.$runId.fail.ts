import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { versionIdSchema } from "../inference/schema";
import { failTrainingRun } from "../server/training-runs";
import {
  parseTrainingJson,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";

const bodySchema = z.strictObject({
  workerId: versionIdSchema,
  error: z.string().min(1).max(2000),
});

export const Route = createFileRoute("/api/training/runs/$runId/fail")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const body = await parseTrainingJson(request, bodySchema);
          return Response.json(
            await failTrainingRun(params.runId, body.workerId, body.error),
          );
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training run failure report failed",
          );
        }
      },
    },
  },
});
