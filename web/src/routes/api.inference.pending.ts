import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DATASET_NAME } from "../datasets/schema";
import { pendingImages } from "../server/prelabels";
import { readInferenceWorker } from "../server/inference-worker-store";

const querySchema = z.object({
  workerId: z.string().regex(DATASET_NAME),
});

export const Route = createFileRoute("/api/inference/pending")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const query = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!query.success) {
          return new Response("workerId is required", { status: 400 });
        }
        const worker = readInferenceWorker(query.data.workerId);
        if (!worker) {
          return new Response("worker must heartbeat before requesting work", {
            status: 409,
          });
        }
        return Response.json({
          images: pendingImages(worker.deployment).map(
            ({ dataset, stem, source }) => ({
              dataset,
              stem,
              source,
            }),
          ),
        });
      },
    },
  },
});
