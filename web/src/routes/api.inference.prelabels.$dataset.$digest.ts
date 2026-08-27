import { createFileRoute } from "@tanstack/react-router";

import { imageRefSchema } from "../datasets/schema";
import { readInferenceWorker } from "../server/inference-worker-store";
import {
  PrelabelFrozenError,
  ModelVersionMismatchError,
  writePrelabel,
} from "../server/prelabels";

export const Route = createFileRoute(
  "/api/inference/prelabels/$dataset/$digest",
)({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        try {
          const workerId = new URL(request.url).searchParams.get("workerId");
          const worker = workerId ? await readInferenceWorker(workerId) : null;
          if (!worker) {
            return new Response("worker must heartbeat before uploading", {
              status: 409,
            });
          }
          await writePrelabel(
            imageRefSchema.parse(params),
            await request.json(),
            worker,
          );
          return Response.json({});
        } catch (error) {
          if (
            error instanceof PrelabelFrozenError ||
            error instanceof ModelVersionMismatchError
          ) {
            return new Response(error.message, { status: 409 });
          }
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 400 },
          );
        }
      },
    },
  },
});
