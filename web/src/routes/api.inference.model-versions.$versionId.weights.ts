import { createFileRoute } from "@tanstack/react-router";

import { readModelVersion } from "../server/model-registry";
import { modelWeightsBlobKey, openBlob } from "../server/blobs";
import {
  InferenceHttpError,
  inferenceWorkerErrorResponse,
} from "../server/inference-worker-http";

export const Route = createFileRoute(
  "/api/inference/model-versions/$versionId/weights",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const version = await readModelVersion(params.versionId);
          if (!version) {
            throw new InferenceHttpError(404, "Model version not found");
          }
          if (
            version.source.kind !== "training_run" ||
            version.artifact.kind !== "ultralytics"
          ) {
            throw new InferenceHttpError(
              409,
              "Model version has no downloadable weights",
            );
          }
          const weights = await openBlob(
            modelWeightsBlobKey(
              version.source.trainingRunId,
              version.source.trainingAttempt,
              version.artifact.weights.digest,
            ),
          );
          if (!weights) {
            throw new Error(
              "Published model artifact is missing from the store",
            );
          }
          if (weights.size !== version.artifact.weights.bytes) {
            throw new Error(
              "Published model artifact size does not match its record",
            );
          }
          return new Response(weights.stream, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(weights.size),
            },
          });
        } catch (error) {
          return inferenceWorkerErrorResponse(
            error,
            "Could not download model weights",
          );
        }
      },
    },
  },
});
