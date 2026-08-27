import { createFileRoute } from "@tanstack/react-router";

import { imageResponse } from "../server/image-files";

export const Route = createFileRoute("/api/inference/images/$digest")({
  server: {
    handlers: {
      GET: ({ params }) => imageResponse(params.digest),
    },
  },
});
