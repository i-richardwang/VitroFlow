import { createFileRoute } from "@tanstack/react-router";

import { imagePreviewResponse } from "../server/transport/http/image-files";

export const Route = createFileRoute("/img/$digest/preview")({
  server: {
    handlers: {
      GET: ({ params }) => imagePreviewResponse(params.digest),
    },
  },
});
