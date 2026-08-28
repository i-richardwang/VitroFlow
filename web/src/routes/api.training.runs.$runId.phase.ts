import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { enterTrainingPhase } from "../server/training-runs";
import {
  parseTrainingJson,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";
import { TRAINING_PHASES } from "../training/schema";
import { trainingWorkerIdentitySchema } from "../training/workers";

const bodySchema = trainingWorkerIdentitySchema.extend({
  phase: z.enum(TRAINING_PHASES),
});

export const Route = createFileRoute("/api/training/runs/$runId/phase")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const { phase, ...owner } = await parseTrainingJson(
            request,
            bodySchema,
          );
          return Response.json(
            await enterTrainingPhase(params.runId, owner, phase),
          );
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training phase transition failed",
          );
        }
      },
    },
  },
});
