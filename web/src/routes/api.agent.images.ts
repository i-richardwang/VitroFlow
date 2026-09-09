import { createFileRoute } from "@tanstack/react-router";

import { refuseWithoutAgentKey } from "../server/transport/http/agent";
import { handleImageUpload } from "../server/transport/http/image-upload";

export const Route = createFileRoute("/api/agent/images")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await refuseWithoutAgentKey(request)) ?? handleImageUpload(request),
    },
  },
});
