import { z } from "zod";

import { modelSchema } from "./schema";

/** A task in the catalogue, with what has accumulated against it. */
export const modelCatalogueEntrySchema = z.strictObject({
  model: modelSchema,
  versionCount: z.number().int().min(0),
  observationCount: z.number().int().min(0),
  datasetCount: z.number().int().min(0),
});

export type ModelCatalogueEntry = z.infer<typeof modelCatalogueEntrySchema>;
