import { createFileRoute } from "@tanstack/react-router";

import { recordTrainingEpoch } from "../server/training/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { trainingEpochReportSchema } from "../domain/training/schema";
import { workerSessionSchema } from "../domain/workers/schema";

const bodySchema = workerSessionSchema.extend(trainingEpochReportSchema.shape);

export const Route = createFileRoute("/api/worker/training/runs/$runId/epochs")(
  {
    server: {
      handlers: {
        POST: async ({ params, request }) => {
          try {
            const { workerId, sessionId, ...report } =
              await parseWorkerSessionJson(request, bodySchema);
            return Response.json(
              await recordTrainingEpoch(
                params.runId,
                { workerId, sessionId },
                report,
              ),
            );
          } catch (error) {
            return workerErrorResponse(error, "Training epoch report failed");
          }
        },
      },
    },
  },
);
