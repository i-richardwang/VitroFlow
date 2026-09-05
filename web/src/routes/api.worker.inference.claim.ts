import { createFileRoute } from "@tanstack/react-router";

import { claimInferenceAssignment } from "../server/inference-outcomes";
import { parseWorkerJson, workerErrorResponse } from "../server/worker-http";
import { workerIdentitySchema } from "../workers/schema";

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
