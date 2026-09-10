import { z } from "zod";

import { modelSchema } from "./schema";

const count = z.number().int().min(0);

/**
 * Everything that can name a model: its versions, the observations read for it,
 * the reviews stored against it, the datasets that train it, and the runs that
 * produced its versions. A model none of these name is a question nobody has
 * answered yet, and can be withdrawn.
 */
export const modelRecordsSchema = z.strictObject({
  versions: count,
  observations: count,
  annotations: count,
  datasets: count,
  trainingRuns: count,
});

export type ModelRecords = z.infer<typeof modelRecordsSchema>;

export type ModelRecordKind = keyof ModelRecords;

export const MODEL_RECORD_KINDS = Object.keys(
  modelRecordsSchema.shape,
) as ModelRecordKind[];

/** A task in the catalogue, with what has accumulated against it. */
export const modelCatalogueEntrySchema = z.strictObject({
  model: modelSchema,
  records: modelRecordsSchema,
});

export type ModelCatalogueEntry = z.infer<typeof modelCatalogueEntrySchema>;
