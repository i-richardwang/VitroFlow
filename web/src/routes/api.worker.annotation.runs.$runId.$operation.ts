import { issueTaskToken } from "../server/transport/mcp/task-credentials";
import { deploymentEndpoint } from "../server/infra/deployment";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { workerSessionSchema } from "../domain/workers/schema";
import {
  renewAnnotationRun,
  failAnnotationRun,
  assignWorkerTask,
  workerAnnotationStatus,
} from "../server/annotation-runs/public";
import {
  parseWorkerSessionJson,
  workerErrorResponse,
} from "../server/transport/http/worker";
const updateSchema = z.discriminatedUnion("operation", [
  workerSessionSchema.extend({ operation: z.literal("lease") }),
  workerSessionSchema.extend({ operation: z.literal("status") }),
  workerSessionSchema.extend({
    operation: z.literal("assign"),
    taskId: z.string().min(1),
    attemptId: z.uuid(),
  }),
  workerSessionSchema.extend({
    operation: z.literal("fail"),
    error: z.string().min(1).max(2000),
  }),
]);
export const Route = createFileRoute(
  "/api/worker/annotation/runs/$runId/$operation",
)({
  server: {
    handlers: {
      POST: async ({ request, params, context }) => {
        try {
          const body = await parseWorkerSessionJson(
            request,
            updateSchema,
            context.workerId,
          );
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
              );
              return Response.json(
                grant.accepted
                  ? grant
                  : {
                      accepted: false,
                      taskId: grant.taskId,
                      token: issueTaskToken(grant.principal),
                      endpoint: deploymentEndpoint().mcpResources.annotation,
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
