import { createFileRoute } from "@tanstack/react-router";

import { describeAgentInterface } from "../server/agent-http";

export const Route = createFileRoute("/api/agent/operations")({
  server: {
    handlers: {
      GET: () => describeAgentInterface(),
    },
  },
});
