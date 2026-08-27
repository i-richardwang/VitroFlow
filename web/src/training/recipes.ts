import { z } from "zod";

import recipeManifest from "../../../configs/yolo26/seed-small.recipe.json";
import { trainingRecipeSchema } from "./schema";

const recipeManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recipe: trainingRecipeSchema,
});

export const YOLO26_SEED_SMALL_RECIPE =
  recipeManifestSchema.parse(recipeManifest).recipe;
