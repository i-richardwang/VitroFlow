import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { versionIdSchema } from "../inference/schema";
import { claimTrainingRun } from "../server/training-runs";

const bodySchema = z.strictObject({ workerId: versionIdSchema });

export const Route = createFileRoute("/api/training/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { workerId } = bodySchema.parse(await request.json());
          const run = await claimTrainingRun(workerId);
          return Response.json({ run });
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            {
              status: 409,
            },
          );
        }
      },
    },
  },
});
