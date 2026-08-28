import { createFileRoute } from "@tanstack/react-router";
import { renewTrainingLease } from "../server/training-runs";
import {
  parseTrainingJson,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";
import { trainingWorkerIdentitySchema } from "../training/workers";

export const Route = createFileRoute("/api/training/runs/$runId/lease")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const owner = await parseTrainingJson(
            request,
            trainingWorkerIdentitySchema,
          );
          return Response.json(await renewTrainingLease(params.runId, owner));
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
