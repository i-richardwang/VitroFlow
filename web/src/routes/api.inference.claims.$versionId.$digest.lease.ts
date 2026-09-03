import { createFileRoute } from "@tanstack/react-router";

import { inferenceTargetSchema } from "../inference/assignments";
import { inferenceWorkerIdentitySchema } from "../inference/workers";
import { renewInferenceClaim } from "../server/inference-outcomes";
import {
  InferenceHttpError,
  inferenceWorkerErrorResponse,
  parseInferenceJson,
} from "../server/inference-worker-http";

export const Route = createFileRoute(
  "/api/inference/claims/$versionId/$digest/lease",
)({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const target = inferenceTargetSchema.safeParse(params);
          if (!target.success) {
            throw new InferenceHttpError(400, "Inference target is invalid");
          }
          const owner = await parseInferenceJson(
            request,
            inferenceWorkerIdentitySchema,
          );
          return Response.json(await renewInferenceClaim(target.data, owner));
        } catch (error) {
          return inferenceWorkerErrorResponse(
            error,
            "Could not renew inference lease",
          );
        }
      },
    },
  },
});
