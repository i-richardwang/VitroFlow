import { createFileRoute } from "@tanstack/react-router";

import { versionIdSchema } from "../inference/schema";
import { recordTrainingEpoch } from "../server/training-runs";
import { trainingEpochReportSchema } from "../training/schema";

const bodySchema = trainingEpochReportSchema.extend({
  workerId: versionIdSchema,
});

export const Route = createFileRoute("/api/training/runs/$runId/epochs")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const { workerId, ...report } = bodySchema.parse(
            await request.json(),
          );
          return Response.json(
            await recordTrainingEpoch(params.runId, workerId, report),
          );
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 409 },
          );
        }
      },
    },
  },
});
