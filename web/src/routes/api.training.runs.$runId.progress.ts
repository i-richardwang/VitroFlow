import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { versionIdSchema } from "../inference/schema";
import { reportTrainingProgress } from "../server/training-runs";

const bodySchema = z.strictObject({
  workerId: versionIdSchema,
  phase: z.enum(["preparing", "training", "validating"]),
  progress: z.number().finite().min(0).max(1),
});

export const Route = createFileRoute("/api/training/runs/$runId/progress")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const body = bodySchema.parse(await request.json());
          return Response.json(
            reportTrainingProgress(
              params.runId,
              body.workerId,
              body.phase,
              body.progress,
            ),
          );
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), {
            status: 409,
          });
        }
      },
    },
  },
});
