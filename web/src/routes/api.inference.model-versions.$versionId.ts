import { createFileRoute } from "@tanstack/react-router";

import { readModelVersion } from "../server/model-registry";

export const Route = createFileRoute("/api/inference/model-versions/$versionId")({
  server: {
    handlers: {
      GET: ({ params }) => {
        try {
          const version = readModelVersion(params.versionId);
          return version
            ? Response.json(version)
            : new Response("Model version not found", { status: 404 });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), {
            status: 400,
          });
        }
      },
    },
  },
});
