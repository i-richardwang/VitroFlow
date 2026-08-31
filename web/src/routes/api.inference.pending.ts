import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { pendingAssignments } from "../server/inference-outcomes";
import {
  InferenceHttpError,
  inferenceWorkerErrorResponse,
} from "../server/inference-worker-http";
import { readInferenceWorker } from "../server/inference-worker-store";

const querySchema = z.object({
  workerId: resourceIdSchema,
});

export const Route = createFileRoute("/api/inference/pending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const query = querySchema.safeParse(
            Object.fromEntries(new URL(request.url).searchParams),
          );
          if (!query.success) {
            throw new InferenceHttpError(400, "workerId is required");
          }
          const worker = await readInferenceWorker(query.data.workerId);
          if (!worker) {
            throw new InferenceHttpError(
              409,
              "worker must heartbeat before requesting work",
            );
          }
          const assignments = await pendingAssignments(worker);
          return Response.json({ assignments });
        } catch (error) {
          return inferenceWorkerErrorResponse(
            error,
            "Could not assign inference work",
          );
        }
      },
    },
  },
});
