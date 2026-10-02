import { createFileRoute } from "@tanstack/react-router";

import { requireEnrolledWorker } from "../server/transport/http/worker";

/** Every worker route sits behind the token of an enrolled worker. */
export const Route = createFileRoute("/api/worker")({
  server: { middleware: [requireEnrolledWorker] },
});
