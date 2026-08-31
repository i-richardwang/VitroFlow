import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { inferenceOutcomeSchema } from "../detection/schema";
import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { recordInferenceOutcome } from "../server/inference-outcomes";
import {
  InferenceHttpError,
  inferenceWorkerErrorResponse,
  parseInferenceJson,
} from "../server/inference-worker-http";
import { readInferenceWorker } from "../server/inference-worker-store";

const targetSchema = z.strictObject({
  versionId: resourceIdSchema,
  digest: imageDigestSchema,
});

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
          const workerId = new URL(request.url).searchParams.get("workerId");
          const worker = workerId ? await readInferenceWorker(workerId) : null;
          if (!worker) {
            throw new InferenceHttpError(
              409,
              "worker must heartbeat before uploading",
            );
          }
          const target = targetSchema.safeParse(params);
          if (!target.success) {
            throw new InferenceHttpError(400, "Inference target is invalid");
          }
          await recordInferenceOutcome(
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
