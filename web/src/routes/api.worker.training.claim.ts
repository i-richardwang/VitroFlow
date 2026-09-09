import { createFileRoute } from "@tanstack/react-router";

import { claimTrainingRun } from "../server/training/public";
import {
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
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
