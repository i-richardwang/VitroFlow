import { createFileRoute } from "@tanstack/react-router";

import { exportDataset } from "../server/export";

export const Route = createFileRoute("/api/export/datasets/$dataset")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const bundle = await exportDataset(params.dataset);
        return bundle
          ? Response.json(bundle)
          : new Response("Not found", { status: 404 });
      },
    },
  },
});
