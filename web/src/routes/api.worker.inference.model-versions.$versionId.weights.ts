import { createFileRoute } from "@tanstack/react-router";

import { readModelVersion } from "../server/models/public";
import { modelWeightsBlobKey } from "../server/training/public";
import { openBlob } from "../server/infra/blobs/store";
import {
  WorkerRequestError,
  workerErrorResponse,
} from "../server/transport/http/worker";

export const Route = createFileRoute(
  "/api/worker/inference/model-versions/$versionId/weights",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const version = await readModelVersion(params.versionId);
          if (!version) {
            throw new WorkerRequestError("Model version not found", 404);
          }
          if (
            version.source.kind !== "training_run" ||
            version.artifact.kind !== "ultralytics"
          ) {
            throw new WorkerRequestError(
              "Model version has no downloadable weights",
              409,
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
          return workerErrorResponse(error, "Could not download model weights");
        }
      },
    },
  },
});
