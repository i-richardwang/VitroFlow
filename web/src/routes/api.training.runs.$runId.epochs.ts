import { createFileRoute } from "@tanstack/react-router";

import { recordTrainingEpoch } from "../server/training-runs";
import {
  parseTrainingJson,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";
import { trainingEpochReportSchema } from "../training/schema";
import { trainingWorkerIdentitySchema } from "../training/workers";

const bodySchema = trainingWorkerIdentitySchema.extend(
  trainingEpochReportSchema.shape,
);

export const Route = createFileRoute("/api/training/runs/$runId/epochs")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const { workerId, sessionId, ...report } = await parseTrainingJson(
            request,
            bodySchema,
          );
          return Response.json(
            await recordTrainingEpoch(
              params.runId,
              { workerId, sessionId },
              report,
            ),
          );
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training epoch report failed",
          );
        }
      },
    },
  },
});
