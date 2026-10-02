import { createFileRoute } from "@tanstack/react-router";
import { workerSessionSchema } from "../domain/workers/schema";
import { claimAnnotationRun } from "../server/annotation-runs/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
export const Route = createFileRoute("/api/worker/annotation/claim")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        try {
          return Response.json({
            run: await claimAnnotationRun(
              await parseWorkerSessionJson(
                request,
                workerSessionSchema,
                context.workerId,
              ),
            ),
          });
        } catch (error) {
          return workerErrorResponse(error, "AI annotation claim failed");
        }
      },
    },
  },
});
