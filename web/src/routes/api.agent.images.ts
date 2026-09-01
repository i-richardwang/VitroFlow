import { createFileRoute } from "@tanstack/react-router";

import { handleImageUpload } from "../server/image-upload";

export const Route = createFileRoute("/api/agent/images")({
  server: {
    handlers: {
      POST: ({ request }) => handleImageUpload(request),
    },
  },
});
