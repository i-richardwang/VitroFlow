import { createFileRoute } from "@tanstack/react-router";

import {
  publishTrainingArtifact,
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../server/training-runs";

export const Route = createFileRoute("/api/training/runs/$runId/artifact")({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        let workerId: string;
        let weights: Uint8Array;
        let publication: unknown;
        try {
          const form = await request.formData();
          const worker = form.get("workerId");
          const weightsFile = form.get("weights");
          const inference = form.get("inference");
          if (
            typeof worker !== "string" ||
            !(weightsFile instanceof File) ||
            !(inference instanceof File)
          ) {
            return new Response(
              "workerId, weights, and inference are required",
              {
                status: 400,
              },
            );
          }
          workerId = worker;
          weights = new Uint8Array(await weightsFile.arrayBuffer());
          publication = JSON.parse(await inference.text());
        } catch {
          return new Response("Invalid training artifact request", {
            status: 400,
          });
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
          const message =
            error instanceof Error ? error.message : String(error);
          if (error instanceof TrainingArtifactValidationError) {
            return new Response(message, { status: 422 });
          }
          if (error instanceof TrainingRunConflictError) {
            return new Response(message, { status: 409 });
          }
          if (error instanceof TrainingRunNotFoundError) {
            return new Response(message, { status: 404 });
          }
          console.error(`Training artifact publication failed: ${message}`);
          return new Response("Training artifact publication failed", {
            status: 500,
          });
        }
      },
    },
  },
});
