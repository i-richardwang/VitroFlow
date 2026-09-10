import { sql } from "drizzle-orm";

import { snapshot } from "../infra/db/client";
import { models } from "../infra/db/schema";
import type { ModelCatalogueEntry } from "../../domain/models/contracts";
import { toModel } from "../models/public";

/** How many rows of one table name this model. */
function referencing(table: string) {
  return sql<number>`(select count(*) from ${sql.raw(table)} where ${sql.raw(table)}.model_id = models.id)`;
}

/**
 * Every task the workbench recognizes, with what has accumulated against it: a
 * task nothing has recorded yet can still be withdrawn.
 */
export function modelCatalogue(): Promise<ModelCatalogueEntry[]> {
  return snapshot(async (db) => {
    const rows = await db
      .select({
        model: models,
        versionCount: referencing("model_versions"),
        observationCount: referencing("experiment_observations"),
        datasetCount: referencing("datasets"),
      })
      .from(models)
      .orderBy(models.id);
    return rows.map((row) => ({
      model: toModel(row.model),
      versionCount: Number(row.versionCount),
      observationCount: Number(row.observationCount),
      datasetCount: Number(row.datasetCount),
    }));
  });
}
