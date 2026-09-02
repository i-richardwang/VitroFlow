import { createFileRoute } from "@tanstack/react-router";

import { serveAgentOperationCall } from "../server/agent-http";

export const Route = createFileRoute("/api/agent/$operation")({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        serveAgentOperationCall(params.operation, request),
    },
  },
});
