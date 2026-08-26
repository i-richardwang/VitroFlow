import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { pendingImages } from "../server/prelabels";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const querySchema = z.object({ pipeline: fingerprint, model: fingerprint });

export const Route = createFileRoute("/api/worker/pending")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const query = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!query.success) {
          return new Response("pipeline and model fingerprints are required", {
            status: 400,
          });
        }
        return Response.json({
          images: pendingImages(query.data).map(
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
