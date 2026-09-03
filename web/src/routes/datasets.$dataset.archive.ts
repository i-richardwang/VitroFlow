import { createFileRoute } from "@tanstack/react-router";

import { archiveFilename } from "../datasets/archive";
import { DatasetManifestTooLargeError } from "../datasets/manifest";
import { datasetArchive } from "../server/dataset-archive";

export const Route = createFileRoute("/datasets/$dataset/archive")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const archive = await datasetArchive(params.dataset);
          if (!archive) return new Response("Not found", { status: 404 });
          return new Response(archive, {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${archiveFilename(params.dataset)}"`,
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          if (error instanceof DatasetManifestTooLargeError) {
            return new Response(error.message, { status: 422 });
          }
          throw error;
        }
      },
    },
  },
});
