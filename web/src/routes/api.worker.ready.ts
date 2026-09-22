import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/worker/ready")({
  server: {
    handlers: {
      GET: () => new Response(null, { status: 204 }),
    },
  },
});
