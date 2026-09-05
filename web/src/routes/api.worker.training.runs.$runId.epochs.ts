import { createFileRoute } from "@tanstack/react-router";

import { recordTrainingEpoch } from "../server/training-runs";
import { parseWorkerJson, workerErrorResponse } from "../server/worker-http";
import { trainingEpochReportSchema } from "../training/schema";
import { workerIdentitySchema } from "../workers/schema";

const bodySchema = workerIdentitySchema.extend(trainingEpochReportSchema.shape);

export const Route = createFileRoute("/api/worker/training/runs/$runId/epochs")(
  {
    server: {
      handlers: {
        POST: async ({ params, request }) => {
          try {
            const { workerId, sessionId, ...report } = await parseWorkerJson(
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
            return workerErrorResponse(error, "Training epoch report failed");
          }
        },
      },
    },
  },
);
