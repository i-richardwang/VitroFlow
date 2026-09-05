import { createFileRoute } from "@tanstack/react-router";

import { inferenceTargetSchema } from "../inference/assignments";
import { renewInferenceClaim } from "../server/inference-outcomes";
import {
  parseWorkerJson,
  parseWorkerValue,
  workerErrorResponse,
} from "../server/worker-http";
import { workerIdentitySchema } from "../workers/schema";

export const Route = createFileRoute(
  "/api/worker/inference/claims/$versionId/$digest/lease",
)({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const target = parseWorkerValue(
            params,
            inferenceTargetSchema,
            "Inference target",
          );
          const owner = await parseWorkerJson(request, workerIdentitySchema);
          return Response.json(await renewInferenceClaim(target, owner));
        } catch (error) {
          return workerErrorResponse(error, "Could not renew inference lease");
        }
      },
    },
  },
});
