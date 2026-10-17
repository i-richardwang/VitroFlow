import { createFileRoute } from "@tanstack/react-router";

import { inferenceTargetSchema } from "../domain/inference/assignments";
import {
  releaseInferenceClaim,
  renewInferenceClaim,
} from "../server/inference/public";
import {
  parseWorkerSessionJson,
  parseWorkerValue,
  workerErrorResponse,
} from "../server/transport/http/worker";
import { workerSessionSchema } from "../domain/workers/schema";

/** The claim a request speaks for: its target, held by the calling session. */
async function claimOf(params: unknown, request: Request, workerId: string) {
  const target = parseWorkerValue(
    params,
    inferenceTargetSchema,
    "Inference target",
  );
  const owner = await parseWorkerSessionJson(
    request,
    workerSessionSchema,
    workerId,
  );
  return { target, owner };
}

export const Route = createFileRoute(
  "/api/worker/inference/claims/$versionId/$digest/lease",
)({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        try {
          const { target, owner } = await claimOf(
            params,
            request,
            context.workerId,
          );
          return Response.json(await renewInferenceClaim(target, owner));
        } catch (error) {
          return workerErrorResponse(error, "Could not renew inference lease");
        }
      },
      DELETE: async ({ params, request, context }) => {
        try {
          const { target, owner } = await claimOf(
            params,
            request,
            context.workerId,
          );
          await releaseInferenceClaim(target, owner);
          return new Response(null, { status: 204 });
        } catch (error) {
          return workerErrorResponse(
            error,
            "Could not release inference lease",
          );
        }
      },
    },
  },
});
