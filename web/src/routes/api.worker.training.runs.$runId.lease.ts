import { createFileRoute } from "@tanstack/react-router";
import { renewTrainingLease } from "../server/training/public";
import {
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { workerIdentitySchema } from "../domain/workers/schema";

export const Route = createFileRoute("/api/worker/training/runs/$runId/lease")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const owner = await parseWorkerJson(request, workerIdentitySchema);
          return Response.json(await renewTrainingLease(params.runId, owner));
        } catch (error) {
          return workerErrorResponse(error, "Training lease renewal failed");
        }
      },
    },
  },
});
