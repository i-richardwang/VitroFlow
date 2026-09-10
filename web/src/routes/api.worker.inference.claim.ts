import { createFileRoute } from "@tanstack/react-router";

import { claimInferenceAssignment } from "../server/inference/public";
import {
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { workerIdentitySchema } from "../domain/workers/schema";

export const Route = createFileRoute("/api/worker/inference/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const owner = await parseWorkerJson(request, workerIdentitySchema);
          return Response.json({
            assignment: await claimInferenceAssignment(owner),
          });
        } catch (error) {
          return workerErrorResponse(error, "Could not claim inference work");
        }
      },
    },
  },
});
