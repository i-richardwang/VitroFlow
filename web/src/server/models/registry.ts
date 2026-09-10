import { desc, eq } from "drizzle-orm";

import {
  SEED_DETECTOR,
  SEED_DETECTOR_BASELINE,
} from "../../domain/models/builtins";
import {
  modelRequestSchema,
  modelSchema,
  modelVersionSchema,
  sameModel,
  sameModelVersion,
  type Model,
  type ModelRef,
  type ModelRequest,
  type ModelVersion,
} from "../../domain/models/schema";
import {
  ModelIdTakenError,
  ModelInUseError,
  ModelNotFoundError,
} from "../../domain/models/errors";
import { database, transaction, type Executor } from "../infra/db/client";
import { modelVersions, models } from "../infra/db/schema";
import { heldBy, modelRecords } from "./records";

/**
 * Model and version rows, written under two rules. Registration is write-once:
 * the same contents again are accepted, different contents under a registered
 * id are refused, so a deployment can install what it always has on every
 * start. Naming a task is a claim instead: the insert either takes the id or
 * finds it taken.
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

/** Claims the id for this model, or nothing when the id is already claimed. */
async function insertModel(model: Model, db: Executor): Promise<Model | null> {
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
  return inserted ? toModel(inserted) : null;
}

/** Declares a model the deployment always has: the same one again is welcome. */
export async function registerModel(
  value: Model,
  executor?: Executor,
): Promise<Model> {
  const db = executor ?? (await database());
  const model = modelSchema.parse(value);
  const inserted = await insertModel(model, db);
  if (inserted) return inserted;
  const existing = await readModel(model.id, db);
  if (!existing || !sameModel(existing, model)) {
    throw new Error(
      `Model ${model.id} is already registered with different contents`,
    );
  }
  return existing;
}

/**
 * Names a task the workbench did not have. Classes are fixed here because
 * every review already stored for the model was drawn from them; a task whose
 * vocabulary changed would be a different task under the same name.
 *
 * The insert is what claims the name, so two people naming the same task at
 * once get one model and one refusal.
 */
export async function createModel(value: ModelRequest): Promise<Model> {
  const request = modelRequestSchema.parse(value);
  const model = modelSchema.parse({
    schemaVersion: 1,
    task: "object_detection",
    ...request,
  });
  const created = await insertModel(model, await database());
  if (!created) {
    throw new ModelIdTakenError(`Model ${model.id} already exists`);
  }
  return created;
}

/**
 * Forgets a task nothing has recorded against yet. The model row is taken
 * before anything is counted against it, so the count is of every record that
 * got there first, and one arriving after finds the task gone.
 */
export async function deleteModel(ref: ModelRef): Promise<void> {
  await transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: models.id })
      .from(models)
      .where(eq(models.id, ref.model))
      .for("update");
    if (!taken) throw new ModelNotFoundError(`Unknown model: ${ref.model}`);
    const held = heldBy(await modelRecords(ref.model, tx));
    if (held.length > 0) {
      throw new ModelInUseError(
        `Model ${ref.model} is named by ${held.join(", ")} and cannot be deleted`,
      );
    }
    await tx.delete(models).where(eq(models.id, ref.model));
  });
}

export async function registerModelVersion(
  value: ModelVersion,
  executor?: Executor,
): Promise<ModelVersion> {
  const db = executor ?? (await database());
  const version = modelVersionSchema.parse(value);
  if (!(await readModel(version.modelId, db))) {
    throw new ModelNotFoundError(`Unknown model: ${version.modelId}`);
  }
  const [inserted] = await db
    .insert(modelVersions)
    .values({
      id: version.id,
      modelId: version.modelId,
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
