import { createFileRoute } from "@tanstack/react-router";
import { workerIdentitySchema } from "../domain/workers/schema";
import { claimAnnotationRun } from "../server/annotation-runs/public";
import {
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
export const Route = createFileRoute("/api/worker/annotation/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json({
            run: await claimAnnotationRun(
              await parseWorkerJson(request, workerIdentitySchema),
            ),
          });
        } catch (error) {
          return workerErrorResponse(error, "AI annotation claim failed");
        }
      },
    },
  },
});
