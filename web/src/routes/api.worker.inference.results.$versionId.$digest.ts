import { createFileRoute } from "@tanstack/react-router";

import { inferenceOutcomeSchema } from "../detection/schema";
import { inferenceTargetSchema } from "../inference/assignments";
import { completeInferenceClaim } from "../server/inference/public";
import {
  parseWorkerIdentity,
  parseWorkerJson,
  parseWorkerValue,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { currentWorkerSession } from "../server/workers/public";

/**
 * One entry for everything a worker reports: a detection or the failure
 * that stands in for it. The path names the pair the outcome is recorded
 * under; the document must have been produced for exactly that pair.
 */
export const Route = createFileRoute(
  "/api/worker/inference/results/$versionId/$digest",
)({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        try {
          const worker = await currentWorkerSession(
            parseWorkerIdentity(new URL(request.url).searchParams),
          );
          const target = parseWorkerValue(
            params,
            inferenceTargetSchema,
            "Inference target",
          );
          await completeInferenceClaim(
            target,
            await parseWorkerJson(request, inferenceOutcomeSchema),
            worker,
          );
          return Response.json({});
        } catch (error) {
          return workerErrorResponse(
            error,
            "Could not record inference result",
          );
        }
      },
    },
  },
});
