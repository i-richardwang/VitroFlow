import { createFileRoute } from "@tanstack/react-router";

import { createTrainingRun } from "../server/training-runs";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { trainingRecipeSchema } from "../training/schema";

export const Route = createFileRoute("/api/datasets/$dataset/training-runs")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const text = await request.text();
          const recipe = trainingRecipeSchema.parse(
            text ? JSON.parse(text) : YOLO26_SEED_SMALL_RECIPE,
          );
          return Response.json(createTrainingRun(params.dataset, recipe), {
            status: 201,
          });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), {
            status: 400,
          });
        }
      },
    },
  },
});
