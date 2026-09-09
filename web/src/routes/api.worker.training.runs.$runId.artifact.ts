import { createFileRoute } from "@tanstack/react-router";

import { resourceIdSchema } from "../identifiers/schema";
import { publishTrainingArtifact } from "../server/training/public";
import {
  parseWorkerForm,
  parseWorkerJsonText,
  parseWorkerValue,
  workerErrorResponse,
} from "../server/transport/http/worker";
import {
  MAX_TRAINING_ARTIFACT_REQUEST_BYTES,
  MAX_TRAINING_MANIFEST_BYTES,
  MAX_TRAINING_WEIGHTS_BYTES,
} from "../training/artifact";

function payloadTooLarge(message: string): Response {
  return new Response(message, { status: 413 });
}

export const Route = createFileRoute(
  "/api/worker/training/runs/$runId/artifact",
)({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        const declaredLength = Number(request.headers.get("content-length"));
        if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
          return new Response("Content-Length is required", { status: 411 });
        }
        if (declaredLength > MAX_TRAINING_ARTIFACT_REQUEST_BYTES) {
          return payloadTooLarge("Training artifact request is too large");
        }
        let owner: { workerId: string; sessionId: string };
        let weights: Uint8Array;
        let publication: unknown;
        try {
          const form = await parseWorkerForm(request);
          const worker = form.get("workerId");
          const session = form.get("sessionId");
          const weightsFile = form.get("weights");
          const inference = form.get("inference");
          if (!(weightsFile instanceof File) || !(inference instanceof File)) {
            return new Response(
              "workerId, sessionId, weights, and inference are required",
              {
                status: 400,
              },
            );
          }
          if (weightsFile.size > MAX_TRAINING_WEIGHTS_BYTES) {
            return payloadTooLarge("Training weights exceed 512 MiB");
          }
          if (inference.size > MAX_TRAINING_MANIFEST_BYTES) {
            return payloadTooLarge("Training manifest exceeds 1 MiB");
          }
          owner = {
            workerId: parseWorkerValue(worker, resourceIdSchema, "workerId"),
            sessionId: parseWorkerValue(session, resourceIdSchema, "sessionId"),
          };
          weights = new Uint8Array(await weightsFile.arrayBuffer());
          publication = parseWorkerJsonText(await inference.text());
        } catch (error) {
          return workerErrorResponse(
            error,
            "Invalid training artifact request",
          );
        }
        try {
          return Response.json(
            await publishTrainingArtifact(
              params.runId,
              owner,
              weights,
              publication,
            ),
          );
        } catch (error) {
          return workerErrorResponse(
            error,
            "Training artifact publication failed",
          );
        }
      },
    },
  },
});
