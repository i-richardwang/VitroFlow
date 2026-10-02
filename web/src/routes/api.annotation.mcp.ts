import { createFileRoute } from "@tanstack/react-router";

import { serveAnnotationMcp } from "../server/transport/mcp/annotation";

export const Route = createFileRoute("/api/annotation/mcp")({
  server: {
    handlers: {
      ANY: ({ request }) => serveAnnotationMcp(request),
    },
  },
});
