import { createFileRoute } from "@tanstack/react-router";

import { inferenceOutcomeSchema } from "../detection/schema";
import { inferenceTargetSchema } from "../inference/assignments";
import { inferenceWorkerIdentitySchema } from "../inference/workers";
import { completeInferenceClaim } from "../server/inference-outcomes";
import {
  InferenceHttpError,
  inferenceWorkerErrorResponse,
  parseInferenceJson,
} from "../server/inference-worker-http";
import { readInferenceWorkerSession } from "../server/inference-worker-store";

/**
 * One entry for everything a worker reports: a detection or the failure
 * that stands in for it. The path names the pair the outcome is recorded
 * under; the document must have been produced for exactly that pair.
 */
export const Route = createFileRoute(
  "/api/inference/results/$versionId/$digest",
)({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        try {
          const identity = inferenceWorkerIdentitySchema.safeParse(
            Object.fromEntries(new URL(request.url).searchParams),
          );
          const worker = identity.success
            ? await readInferenceWorkerSession(identity.data)
            : null;
          if (!worker) {
            throw new InferenceHttpError(
              409,
              "worker session must heartbeat before uploading",
            );
          }
          const target = inferenceTargetSchema.safeParse(params);
          if (!target.success) {
            throw new InferenceHttpError(400, "Inference target is invalid");
          }
          await completeInferenceClaim(
            target.data,
            await parseInferenceJson(request, inferenceOutcomeSchema),
            worker,
          );
          return Response.json({});
        } catch (error) {
          return inferenceWorkerErrorResponse(
            error,
            "Could not record inference result",
          );
        }
      },
    },
  },
});
