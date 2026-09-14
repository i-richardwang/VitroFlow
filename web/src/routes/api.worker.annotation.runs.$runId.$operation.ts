import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { workerIdentitySchema } from "../domain/workers/schema";
import {
  annotationProgressSchema,
  annotationRunResultSchema,
} from "../domain/annotation-runs/schema";
import {
  annotationRunImage,
  renewAnnotationRun,
  progressAnnotationRun,
  failAnnotationRun,
  completeAnnotationRun,
} from "../server/annotation-runs/public";
import { imageResponse } from "../server/transport/http/image-files";
import {
  parseWorkerIdentity,
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
const updateSchema = z.discriminatedUnion("operation", [
  workerIdentitySchema.extend({ operation: z.literal("lease") }),
  workerIdentitySchema.extend({
    operation: z.literal("progress"),
    progress: annotationProgressSchema,
  }),
  workerIdentitySchema.extend({
    operation: z.literal("fail"),
    error: z.string().min(1).max(2000),
  }),
  workerIdentitySchema.extend({
    operation: z.literal("complete"),
    result: annotationRunResultSchema,
  }),
]);
export const Route = createFileRoute(
  "/api/worker/annotation/runs/$runId/$operation",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (params.operation !== "image")
          return new Response("Not found", { status: 404 });
        try {
          return imageResponse(
            await annotationRunImage(
              params.runId,
              parseWorkerIdentity(new URL(request.url).searchParams),
            ),
          );
        } catch (error) {
          return workerErrorResponse(error, "AI annotation image failed");
        }
      },
      POST: async ({ request, params }) => {
        try {
          const body = await parseWorkerJson(request, updateSchema);
          if (body.operation !== params.operation)
            return new Response("Operation mismatch", { status: 400 });
          switch (body.operation) {
            case "lease":
              await renewAnnotationRun(params.runId, body);
              break;
            case "progress":
              await progressAnnotationRun(
                params.runId,
                body,
                body.progress.completed,
                body.progress.total,
              );
              break;
            case "fail":
              await failAnnotationRun(params.runId, body, body.error);
              break;
            case "complete":
              await completeAnnotationRun(params.runId, body, body.result);
              break;
          }
          return Response.json({ ok: true });
        } catch (error) {
          return workerErrorResponse(error, "AI annotation update failed");
        }
      },
    },
  },
});
