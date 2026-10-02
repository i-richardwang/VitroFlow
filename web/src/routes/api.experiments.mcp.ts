import { createFileRoute } from "@tanstack/react-router";

import { serveExperimentsMcp } from "../server/transport/mcp/experiments";

export const Route = createFileRoute("/api/experiments/mcp")({
  server: {
    handlers: {
      ANY: ({ request }) => serveExperimentsMcp(request),
    },
  },
});
