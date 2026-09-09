import { desc, eq } from "drizzle-orm";

import { SEED_DETECTOR, SEED_DETECTOR_BASELINE } from "../../models/builtins";
import {
  modelSchema,
  modelVersionSchema,
  sameModel,
  sameModelVersion,
  type Model,
  type ModelVersion,
} from "../../models/schema";
import { database, type Executor } from "../infra/db/client";
import { modelVersions, models } from "../infra/db/schema";

/**
 * Model and version rows. Registration is write-once: the same contents again
 * are accepted, different contents under a registered id are refused. Builtin models
 * use the same registration operations during application initialization.
 */

export function toModel(row: typeof models.$inferSelect): Model {
  return modelSchema.parse({
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    task: row.task,
    classes: row.classes,
    metrics: row.metrics,
  });
}

export function toModelVersion(
  row: typeof modelVersions.$inferSelect,
): ModelVersion {
  return modelVersionSchema.parse({
    schemaVersion: 1,
    id: row.id,
    modelId: row.modelId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    source: row.source,
    artifact: row.artifact,
  });
}

export async function readModel(
  modelId: string,
  executor?: Executor,
): Promise<Model | null> {
  const db = executor ?? (await database());
  const [row] = await db.select().from(models).where(eq(models.id, modelId));
  return row ? toModel(row) : null;
}

export async function readModelVersion(
  versionId: string,
  executor?: Executor,
): Promise<ModelVersion | null> {
  const db = executor ?? (await database());
  const [row] = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.id, versionId));
  return row ? toModelVersion(row) : null;
}

export async function registerModel(
  value: Model,
  executor?: Executor,
): Promise<Model> {
  const db = executor ?? (await database());
  const model = modelSchema.parse(value);
  const [inserted] = await db
    .insert(models)
    .values({
      id: model.id,
      name: model.name,
      task: model.task,
      classes: [...model.classes],
      metrics: [...model.metrics],
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return toModel(inserted);
  const existing = await readModel(model.id, db);
  if (!existing || !sameModel(existing, model)) {
    throw new Error(
      `Model ${model.id} is already registered with different contents`,
    );
  }
  return existing;
}

export async function registerModelVersion(
  value: ModelVersion,
  executor?: Executor,
): Promise<ModelVersion> {
  const db = executor ?? (await database());
  const version = modelVersionSchema.parse(value);
  if (!(await readModel(version.modelId, db))) {
    throw new Error(`Unknown model: ${version.modelId}`);
  }
  const [inserted] = await db
    .insert(modelVersions)
    .values({
      id: version.id,
      modelId: version.modelId,
      name: version.name,
      createdAt: new Date(version.createdAt),
      source: version.source,
      artifact: version.artifact,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return toModelVersion(inserted);
  const existing = await readModelVersion(version.id, db);
  if (!existing || !sameModelVersion(existing, version)) {
    throw new Error(
      `Model version ${version.id} is already registered with different contents`,
    );
  }
  return existing;
}

export async function listModels(): Promise<Model[]> {
  const db = await database();
  const rows = await db.select().from(models).orderBy(models.id);
  return rows.map(toModel);
}

/**
 * Every version of every model, newest first. Builtin baselines carry the
 * package's date, so they follow whatever has been trained since.
 */
export async function listAllModelVersions(): Promise<ModelVersion[]> {
  const db = await database();
  const rows = await db
    .select()
    .from(modelVersions)
    .orderBy(desc(modelVersions.createdAt), desc(modelVersions.id));
  return rows.map(toModelVersion);
}

/** The models every deployment has: part of opening the database. */
export async function installBuiltinModels(db: Executor): Promise<void> {
  await registerModel(SEED_DETECTOR, db);
  await registerModelVersion(SEED_DETECTOR_BASELINE, db);
}
