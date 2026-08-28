import { createFileRoute } from "@tanstack/react-router";

import { versionIdSchema } from "../inference/schema";
import { publishTrainingArtifact } from "../server/training-runs";
import {
  parseTrainingForm,
  parseTrainingJsonText,
  parseTrainingValue,
  trainingWorkerErrorResponse,
} from "../server/training-worker-http";

export const Route = createFileRoute("/api/training/runs/$runId/artifact")({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        let workerId: string;
        let weights: Uint8Array;
        let publication: unknown;
        try {
          const form = await parseTrainingForm(request);
          const worker = form.get("workerId");
          const weightsFile = form.get("weights");
          const inference = form.get("inference");
          if (!(weightsFile instanceof File) || !(inference instanceof File)) {
            return new Response(
              "workerId, weights, and inference are required",
              {
                status: 400,
              },
            );
          }
          workerId = parseTrainingValue(worker, versionIdSchema, "workerId");
          weights = new Uint8Array(await weightsFile.arrayBuffer());
          publication = parseTrainingJsonText(await inference.text());
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Invalid training artifact request",
          );
        }
        try {
          return Response.json(
            await publishTrainingArtifact(
              params.runId,
              workerId,
              weights,
              publication,
            ),
          );
        } catch (error) {
          return trainingWorkerErrorResponse(
            error,
            "Training artifact publication failed",
          );
        }
      },
    },
  },
});
