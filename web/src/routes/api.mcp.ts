import { createFileRoute } from "@tanstack/react-router";

import { guardMcpRequest, mcpHandler } from "../server/agent-mcp";

function serve(request: Request): Promise<Response> | Response {
  return guardMcpRequest(request) ?? mcpHandler.fetch(request);
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => serve(request),
      POST: ({ request }) => serve(request),
      DELETE: ({ request }) => serve(request),
    },
  },
});
