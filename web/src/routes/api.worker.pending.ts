import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DATASET_NAME } from "../datasets/schema";
import { pendingImages } from "../server/prelabels";
import { readWorker } from "../server/worker-store";

const querySchema = z.object({
  worker_id: z.string().regex(DATASET_NAME),
});

export const Route = createFileRoute("/api/worker/pending")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const query = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!query.success) {
          return new Response("worker_id is required", { status: 400 });
        }
        const worker = readWorker(query.data.worker_id);
        if (!worker) {
          return new Response("worker must heartbeat before requesting work", {
            status: 409,
          });
        }
        return Response.json({
          images: pendingImages(worker.prelabeler).map(
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
