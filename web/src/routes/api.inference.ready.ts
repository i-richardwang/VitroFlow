import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/inference/ready")({
  server: {
    handlers: {
      GET: () => Response.json({ role: "inference" }),
    },
  },
});
