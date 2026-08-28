import { createFileRoute } from "@tanstack/react-router";
import { claimTrainingRun } from "../server/training-runs";
import {
  parseTrainingJson,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";
import { trainingWorkerIdentitySchema } from "../training/workers";

export const Route = createFileRoute("/api/training/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const owner = await parseTrainingJson(
            request,
            trainingWorkerIdentitySchema,
          );
          const run = await claimTrainingRun(owner);
          return Response.json({ run });
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training run claim failed",
          );
        }
      },
    },
  },
});
