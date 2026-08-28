import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { versionIdSchema } from "../inference/schema";
import { enterTrainingPhase } from "../server/training-runs";
import {
  parseTrainingJson,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";
import { TRAINING_PHASES } from "../training/schema";

const bodySchema = z.strictObject({
  workerId: versionIdSchema,
  phase: z.enum(TRAINING_PHASES),
});

export const Route = createFileRoute("/api/training/runs/$runId/phase")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const { workerId, phase } = await parseTrainingJson(
            request,
            bodySchema,
          );
          return Response.json(
            await enterTrainingPhase(params.runId, workerId, phase),
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
