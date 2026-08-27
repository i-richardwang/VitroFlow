import { createFileRoute } from "@tanstack/react-router";

import { imageResponse } from "../server/image-files";

export const Route = createFileRoute("/api/export/images/$digest")({
  server: {
    handlers: {
      GET: ({ params }) => imageResponse(params.digest),
    },
  },
});
