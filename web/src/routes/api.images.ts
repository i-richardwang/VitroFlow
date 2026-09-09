import { createFileRoute } from "@tanstack/react-router";

import { handleImageUpload } from "../server/transport/http/image-upload";

export const Route = createFileRoute("/api/images")({
  server: {
    handlers: {
      POST: ({ request }) => handleImageUpload(request),
    },
  },
});
