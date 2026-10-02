import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../server/auth/public";
import { annotationResourceMetadata } from "../server/transport/mcp/access";

/**
 * OAuth discovery lives at the site root: RFC 8414 authorization server
 * metadata and RFC 9728 protected resource metadata for each MCP server.
 * Better Auth answers from the same handler that serves /api/auth; the
 * annotation server's metadata is derived from it.
 */
async function discover(request: Request): Promise<Response> {
  return (
    (await annotationResourceMetadata(request)) ??
    (await auth()).handler(request)
  );
}

export const Route = createFileRoute("/.well-known/$")({
  server: {
    handlers: {
      GET: ({ request }) => discover(request),
      HEAD: ({ request }) => discover(request),
    },
  },
});
