import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../server/auth";

/** Better Auth's own endpoints: sign-in, sign-out, and session reads. */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => (await auth()).handler(request),
      POST: async ({ request }) => (await auth()).handler(request),
    },
  },
});
