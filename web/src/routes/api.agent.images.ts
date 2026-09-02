import { createFileRoute } from "@tanstack/react-router";

import { agentApiPrincipal } from "../server/agent-http";
import { handleImageUpload } from "../server/image-upload";

export const Route = createFileRoute("/api/agent/images")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const principal = await agentApiPrincipal(request);
        return principal instanceof Response
          ? principal
          : handleImageUpload(request);
      },
    },
  },
});
