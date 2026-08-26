import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { pendingImages } from "../server/prelabels";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const querySchema = z.object({
  version_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  fingerprint,
});

export const Route = createFileRoute("/api/worker/pending")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const query = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!query.success) {
          return new Response(
            "prelabeler version_id and fingerprint are required",
            { status: 400 },
          );
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
