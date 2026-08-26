import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { IDENTIFIER } from "../jobs/schema";
import { claimNextJob } from "../server/job-store";

const claimSchema = z.strictObject({ workerId: z.string().regex(IDENTIFIER) });

export const Route = createFileRoute("/api/worker/jobs/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const claim = claimNextJob(
            claimSchema.parse(await request.json()).workerId,
          );
          return claim
            ? Response.json(claim)
            : new Response(null, { status: 204 });
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 400 },
          );
        }
      },
    },
  },
});
