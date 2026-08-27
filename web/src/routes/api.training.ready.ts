import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/training/ready")({
  server: {
    handlers: {
      GET: () => Response.json({ role: "training" }),
    },
  },
});
