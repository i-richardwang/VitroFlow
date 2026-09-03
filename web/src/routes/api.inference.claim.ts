import { createFileRoute } from "@tanstack/react-router";

import { inferenceWorkerIdentitySchema } from "../inference/workers";
import { claimInferenceAssignment } from "../server/inference-outcomes";
import {
  InferenceHttpError,
  inferenceWorkerErrorResponse,
  parseInferenceJson,
} from "../server/inference-worker-http";
import { readInferenceWorkerSession } from "../server/inference-worker-store";

export const Route = createFileRoute("/api/inference/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const identity = await parseInferenceJson(
            request,
            inferenceWorkerIdentitySchema,
          );
          const worker = await readInferenceWorkerSession(identity);
          if (!worker) {
            throw new InferenceHttpError(
              409,
              "worker session must heartbeat before claiming work",
            );
          }
          return Response.json({
            assignment: await claimInferenceAssignment(worker),
          });
        } catch (error) {
          return inferenceWorkerErrorResponse(
            error,
            "Could not claim inference work",
          );
        }
      },
    },
  },
});
