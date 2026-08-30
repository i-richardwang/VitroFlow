import { eq } from "drizzle-orm";

import { SEED_DETECTOR, SEED_DETECTOR_BASELINE } from "../models/builtins";
import {
  modelSchema,
  modelVersionSchema,
  sameModel,
  sameModelVersion,
  type Model,
  type ModelVersion,
} from "../models/schema";
import type { Executor } from "./client";
import { modelVersions, models } from "./schema";

/**
 * Model and version rows. Registration is write-once: the same contents again
 * are accepted, different contents under a registered id are refused. The
 * database installs the builtin models with the same primitives when it
 * opens, so every path in — server, tests, development — starts from them.
 */

export function toModel(row: typeof models.$inferSelect): Model {
  return modelSchema.parse({
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    task: row.task,
    classes: row.classes,
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
  db: Executor,
): Promise<Model | null> {
  const [row] = await db.select().from(models).where(eq(models.id, modelId));
  return row ? toModel(row) : null;
}

export async function readModelVersion(
  versionId: string,
  db: Executor,
): Promise<ModelVersion | null> {
  const [row] = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.id, versionId));
  return row ? toModelVersion(row) : null;
}

export async function registerModel(
  value: Model,
  db: Executor,
): Promise<Model> {
  const model = modelSchema.parse(value);
  const [inserted] = await db
    .insert(models)
    .values({
      id: model.id,
      name: model.name,
      task: model.task,
      classes: [...model.classes],
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
  db: Executor,
): Promise<ModelVersion> {
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

/** The models every deployment has: part of opening the database. */
export async function installBuiltins(db: Executor): Promise<void> {
  await registerModel(SEED_DETECTOR, db);
  await registerModelVersion(SEED_DETECTOR_BASELINE, db);
}
