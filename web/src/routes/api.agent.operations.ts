import { createFileRoute } from "@tanstack/react-router";

import { serveAgentInterface } from "../server/transport/http/agent";

export const Route = createFileRoute("/api/agent/operations")({
  server: {
    handlers: {
      GET: ({ request }) => serveAgentInterface(request),
    },
  },
});
