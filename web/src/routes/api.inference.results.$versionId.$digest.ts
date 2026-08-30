import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { imageDigestSchema } from "../datasets/schema";
import { versionIdSchema } from "../inference/schema";
import {
  DetectionConflictError,
  DetectionImageNotFoundError,
  InvalidDetectionOutcomeError,
  ProducerMismatchError,
  recordInferenceOutcome,
} from "../server/detections";
import { readInferenceWorker } from "../server/inference-worker-store";

const targetSchema = z.strictObject({
  versionId: versionIdSchema,
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
            return new Response("worker must heartbeat before uploading", {
              status: 409,
            });
          }
          await recordInferenceOutcome(
            targetSchema.parse(params),
            await request.json(),
            worker,
          );
          return Response.json({});
        } catch (error) {
          if (error instanceof DetectionConflictError) {
            return new Response(error.message, { status: 409 });
          }
          if (error instanceof DetectionImageNotFoundError) {
            return new Response(error.message, { status: 404 });
          }
          if (error instanceof ProducerMismatchError) {
            return new Response(error.message, { status: 422 });
          }
          if (
            error instanceof SyntaxError ||
            error instanceof z.ZodError ||
            error instanceof InvalidDetectionOutcomeError
          ) {
            return new Response(error.message, { status: 400 });
          }
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(`Record inference result failed: ${message}`);
          return new Response("Could not record inference result", {
            status: 500,
          });
        }
      },
    },
  },
});
