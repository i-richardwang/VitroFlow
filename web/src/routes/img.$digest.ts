import { createFileRoute } from "@tanstack/react-router";

import { imageResponse } from "../server/image-files";

export const Route = createFileRoute("/img/$digest")({
  server: {
    handlers: {
      GET: ({ params }) => imageResponse(params.digest),
    },
  },
});
