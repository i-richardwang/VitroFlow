import { desc, eq } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import { modelVersions, models } from "../db/schema";
import {
  modelSchema,
  modelVersionSchema,
  sameModel,
  sameModelVersion,
  type Model,
  type ModelVersion,
} from "../models/schema";
import { TRADITIONAL_MODEL_MANIFEST } from "../models/builtins";

type VersionRow = typeof modelVersions.$inferSelect;

function builtinModel(datasetId: string): Model {
  return modelSchema.parse({
    schemaVersion: 1,
    id: datasetId,
    name: `${datasetId} seed detector`,
    task: "object_detection",
    classes: ["seed"],
  });
}

function builtinTraditionalVersion(datasetId: string): ModelVersion {
  return modelVersionSchema.parse({
    schemaVersion: 1,
    id: `${datasetId}.traditional-v1`,
    modelId: datasetId,
    name: "Traditional vision baseline",
    createdAt: TRADITIONAL_MODEL_MANIFEST.createdAt,
    source: {
      kind: "builtin",
      definition: TRADITIONAL_MODEL_MANIFEST.definition,
    },
    artifact: {
      kind: "traditional",
      digest: TRADITIONAL_MODEL_MANIFEST.artifactDigest,
    },
  });
}

function toModel(row: typeof models.$inferSelect): Model {
  return modelSchema.parse({
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    task: row.task,
    classes: row.classes,
  });
}

function toModelVersion(row: VersionRow): ModelVersion {
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

async function readModel(modelId: string, db: Executor): Promise<Model | null> {
  const [row] = await db.select().from(models).where(eq(models.id, modelId));
  return row ? toModel(row) : null;
}

export async function listModels(): Promise<Model[]> {
  const db = await database();
  const rows = await db.select().from(models).orderBy(models.id);
  return rows.map(toModel);
}

/** Registers a logical model; registering the same contents again is a no-op. */
export async function registerModel(
  model: Model,
  db?: Executor,
): Promise<Model> {
  const valid = modelSchema.parse(model);
  const executor = db ?? (await database());
  const [inserted] = await executor
    .insert(models)
    .values({
      id: valid.id,
      name: valid.name,
      task: valid.task,
      classes: [...valid.classes],
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return toModel(inserted);
  const existing = await readModel(valid.id, executor);
  if (!existing || !sameModel(existing, valid)) {
    throw new Error(
      `Model ${valid.id} is already registered with different contents`,
    );
  }
  return existing;
}

/** A dataset's logical model together with the builtin baseline version. */
export async function ensureDatasetModel(
  datasetId: string,
  db: Executor,
): Promise<ModelVersion> {
  await registerModel(builtinModel(datasetId), db);
  return registerModelVersion(builtinTraditionalVersion(datasetId), db);
}

export async function readModelVersion(
  versionId: string,
  db?: Executor,
): Promise<ModelVersion | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.id, versionId));
  return row ? toModelVersion(row) : null;
}

/** Versions of a model, newest first. */
export async function listModelVersions(
  modelId: string,
): Promise<ModelVersion[]> {
  const db = await database();
  const rows = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.modelId, modelId))
    .orderBy(desc(modelVersions.createdAt), desc(modelVersions.id));
  return rows.map(toModelVersion);
}

/** Registers one immutable executable version; the same contents again is a no-op. */
export async function registerModelVersion(
  value: ModelVersion,
  db?: Executor,
): Promise<ModelVersion> {
  const version = modelVersionSchema.parse(value);
  const executor = db ?? (await database());
  if (!(await readModel(version.modelId, executor))) {
    throw new Error(`Unknown model: ${version.modelId}`);
  }
  const [inserted] = await executor
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
  const existing = await readModelVersion(version.id, executor);
  if (!existing || !sameModelVersion(existing, version)) {
    throw new Error(
      `Model version ${version.id} is already registered with different contents`,
    );
  }
  return existing;
}
