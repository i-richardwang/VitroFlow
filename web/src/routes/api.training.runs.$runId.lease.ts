import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { versionIdSchema } from "../inference/schema";
import { renewTrainingLease } from "../server/training-runs";
import {
  parseTrainingJson,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";

const bodySchema = z.strictObject({ workerId: versionIdSchema });

export const Route = createFileRoute("/api/training/runs/$runId/lease")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const { workerId } = await parseTrainingJson(request, bodySchema);
          return Response.json(
            await renewTrainingLease(params.runId, workerId),
          );
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training lease renewal failed",
          );
        }
      },
    },
  },
});
