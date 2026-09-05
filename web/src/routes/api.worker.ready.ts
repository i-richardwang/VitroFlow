import { createFileRoute } from "@tanstack/react-router";

/** Answers a worker that presents the worker credential; the realm refuses the rest. */
export const Route = createFileRoute("/api/worker/ready")({
  server: {
    handlers: {
      GET: () => new Response(null, { status: 204 }),
    },
  },
});
