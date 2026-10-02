import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { enterTrainingPhase } from "../server/training/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { TRAINING_PHASES } from "../domain/training/schema";
import { workerSessionSchema } from "../domain/workers/schema";

const bodySchema = workerSessionSchema.extend({
  phase: z.enum(TRAINING_PHASES),
});

export const Route = createFileRoute("/api/worker/training/runs/$runId/phase")({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        try {
          const { phase, ...owner } = await parseWorkerSessionJson(
            request,
            bodySchema,
            context.workerId,
          );
          return Response.json(
            await enterTrainingPhase(params.runId, owner, phase),
          );
        } catch (error) {
          return workerErrorResponse(error, "Training phase transition failed");
        }
      },
    },
  },
});
