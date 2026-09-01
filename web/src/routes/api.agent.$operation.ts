import { createFileRoute } from "@tanstack/react-router";

import { handleAgentOperationCall } from "../server/agent-http";

export const Route = createFileRoute("/api/agent/$operation")({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        handleAgentOperationCall(params.operation, request),
    },
  },
});
