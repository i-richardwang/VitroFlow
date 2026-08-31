import { desc, eq } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import * as registry from "../db/registry";
import { modelVersions, models } from "../db/schema";
import type { Model, ModelVersion } from "../models/schema";

export { toModelVersion } from "../db/registry";

export async function readModel(
  modelId: string,
  db?: Executor,
): Promise<Model | null> {
  return registry.readModel(modelId, db ?? (await database()));
}

export async function listModels(db?: Executor): Promise<Model[]> {
  const rows = await (db ?? (await database()))
    .select()
    .from(models)
    .orderBy(models.id);
  return rows.map(registry.toModel);
}

export async function readModelVersion(
  versionId: string,
  db?: Executor,
): Promise<ModelVersion | null> {
  return registry.readModelVersion(versionId, db ?? (await database()));
}

/** Versions of a model, newest first. */
export async function listModelVersions(
  modelId: string,
  db?: Executor,
): Promise<ModelVersion[]> {
  const rows = await (db ?? (await database()))
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.modelId, modelId))
    .orderBy(desc(modelVersions.createdAt), desc(modelVersions.id));
  return rows.map(registry.toModelVersion);
}

/**
 * Every version of every model, newest first. Builtin baselines carry the
 * package's date, so they follow whatever has been trained since.
 */
export async function listAllModelVersions(
  db?: Executor,
): Promise<ModelVersion[]> {
  const rows = await (db ?? (await database()))
    .select()
    .from(modelVersions)
    .orderBy(desc(modelVersions.createdAt), desc(modelVersions.id));
  return rows.map(registry.toModelVersion);
}

/** Registers one immutable executable version; the same contents again is a no-op. */
export async function registerModelVersion(
  version: ModelVersion,
  db?: Executor,
): Promise<ModelVersion> {
  return registry.registerModelVersion(version, db ?? (await database()));
}
