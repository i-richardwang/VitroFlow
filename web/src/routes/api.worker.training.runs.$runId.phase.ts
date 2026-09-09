import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { enterTrainingPhase } from "../server/training/public";
import {
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { TRAINING_PHASES } from "../training/schema";
import { workerIdentitySchema } from "../workers/schema";

const bodySchema = workerIdentitySchema.extend({
  phase: z.enum(TRAINING_PHASES),
});

export const Route = createFileRoute("/api/worker/training/runs/$runId/phase")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const { phase, ...owner } = await parseWorkerJson(
            request,
            bodySchema,
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
