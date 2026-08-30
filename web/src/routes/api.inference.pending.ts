import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { versionIdSchema } from "../inference/schema";
import { pendingAssignments } from "../server/detections";
import { readInferenceWorker } from "../server/inference-worker-store";

const querySchema = z.object({
  workerId: versionIdSchema,
});

export const Route = createFileRoute("/api/inference/pending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!query.success) {
          return new Response("workerId is required", { status: 400 });
        }
        const worker = await readInferenceWorker(query.data.workerId);
        if (!worker) {
          return new Response("worker must heartbeat before requesting work", {
            status: 409,
          });
        }
        const assignments = await pendingAssignments(worker);
        return Response.json({ assignments });
      },
    },
  },
});
