import { createFileRoute } from "@tanstack/react-router";

import { serveMcp } from "../server/transport/mcp/agent";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => serveMcp(request),
    },
  },
});
