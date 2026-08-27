import * as fs from "node:fs";

import { createFileRoute } from "@tanstack/react-router";

import { snapshotImagePath } from "../server/dataset-snapshots";
import { snapshotForRun } from "../server/training-runs";

export const Route = createFileRoute("/api/training/runs/$runId/images/$index")({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        try {
          const workerId = new URL(request.url).searchParams.get("workerId");
          if (!workerId) return new Response("workerId is required", { status: 400 });
          const snapshot = snapshotForRun(params.runId, workerId);
          const index = Number(params.index);
          const image = Number.isInteger(index)
            ? snapshotImagePath(snapshot.id, index)
            : null;
          if (!image) return new Response("Not found", { status: 404 });
          return new Response(fs.readFileSync(image.path), {
            headers: { "X-Content-SHA256": image.digest },
          });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), {
            status: 409,
          });
        }
      },
    },
  },
});
