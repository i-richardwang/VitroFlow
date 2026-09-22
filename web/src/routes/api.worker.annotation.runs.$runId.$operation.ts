import { issueTaskToken } from "../server/transport/mcp/task-credentials";
import { deploymentEndpoint } from "../server/infra/deployment";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { workerIdentitySchema } from "../domain/workers/schema";
import { annotationRuntimeSchema } from "../domain/annotation-runs/schema";
import {
  renewAnnotationRun,
  failAnnotationRun,
  assignWorkerTask,
  workerAnnotationStatus,
} from "../server/annotation-runs/public";
import {
  parseWorkerJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
const updateSchema = z.discriminatedUnion("operation", [
  workerIdentitySchema.extend({ operation: z.literal("lease") }),
  workerIdentitySchema.extend({ operation: z.literal("status") }),
  workerIdentitySchema.extend({
    operation: z.literal("assign"),
    taskId: z.string().min(1),
    attemptId: z.string().uuid(),
    runtime: annotationRuntimeSchema,
  }),
  workerIdentitySchema.extend({
    operation: z.literal("fail"),
    error: z.string().min(1).max(2000),
  }),
]);
export const Route = createFileRoute(
  "/api/worker/annotation/runs/$runId/$operation",
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await parseWorkerJson(request, updateSchema);
          if (body.operation !== params.operation)
            return new Response("Operation mismatch", { status: 400 });
          switch (body.operation) {
            case "lease":
              await renewAnnotationRun(params.runId, body);
              break;
            case "fail":
              await failAnnotationRun(params.runId, body, body.error);
              break;
            case "status":
              return Response.json(
                await workerAnnotationStatus(params.runId, body),
              );
            case "assign": {
              const grant = await assignWorkerTask(
                params.runId,
                body,
                body.taskId,
                body.attemptId,
                body.runtime,
              );
              return Response.json(
                grant.accepted
                  ? grant
                  : {
                      accepted: false,
                      runId: params.runId,
                      taskId: grant.taskId,
                      token: issueTaskToken(grant.principal),
                      endpoint: deploymentEndpoint().mcpResource,
                    },
              );
            }
          }
          return Response.json({ ok: true });
        } catch (error) {
          return workerErrorResponse(error, "AI annotation operation failed");
        }
      },
    },
  },
});
