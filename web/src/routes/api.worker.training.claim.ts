import { createFileRoute } from "@tanstack/react-router";

import { claimTrainingRun } from "../server/training-runs";
import { parseWorkerJson, workerErrorResponse } from "../server/worker-http";
import { workerIdentitySchema } from "../workers/schema";

export const Route = createFileRoute("/api/worker/training/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const owner = await parseWorkerJson(request, workerIdentitySchema);
          return Response.json({ run: await claimTrainingRun(owner) });
        } catch (error) {
          return workerErrorResponse(error, "Training run claim failed");
        }
      },
    },
  },
});
