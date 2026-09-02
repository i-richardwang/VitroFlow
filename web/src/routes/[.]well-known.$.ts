import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../server/auth";

/**
 * OAuth discovery lives at the site root: RFC 8414 authorization server
 * metadata and RFC 9728 protected resource metadata for the MCP endpoint.
 * Better Auth answers both from the same handler that serves /api/auth.
 */
async function discover(request: Request): Promise<Response> {
  return (await auth()).handler(request);
}

export const Route = createFileRoute("/.well-known/$")({
  server: {
    handlers: {
      GET: ({ request }) => discover(request),
      HEAD: ({ request }) => discover(request),
    },
  },
});
