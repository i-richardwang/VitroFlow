import { and, asc, eq, sql } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import { datasetSnapshots, datasets, images } from "../db/schema";
import {
  datasetSchema,
  imageRefSchema,
  type Dataset,
  type ImageRef,
} from "../datasets/schema";
import type { ImageSplit } from "../training/schema";
import { imageBlobKey, removeBlob } from "./blobs";
import { ensureDatasetModel, readModelVersion } from "./model-registry";

export interface DatasetImage extends ImageRef {
  /** The path documents reference the image by, relative to a data root. */
  source: string;
  /** Where the bytes live, by content digest. */
  blobKey: string;
  extension: string;
  bytes: number;
  digest: string;
  split: ImageSplit | null;
}

function imageSource(ref: ImageRef, extension: string): string {
  return `images/${ref.dataset}/${ref.stem}${extension}`;
}

export function toDatasetImage(row: typeof images.$inferSelect): DatasetImage {
  const ref = { dataset: row.datasetId, stem: row.stem };
  return {
    ...ref,
    source: imageSource(ref, row.extension),
    blobKey: imageBlobKey(row.digest),
    extension: row.extension,
    bytes: row.bytes,
    digest: row.digest,
    split: row.split,
  };
}

function toDataset(row: typeof datasets.$inferSelect): Dataset {
  return datasetSchema.parse({
    schemaVersion: 1,
    id: row.id,
    modelId: row.modelId,
    selectedModelVersionId: row.selectedModelVersionId,
  });
}

export async function readDataset(
  datasetId: string,
  db?: Executor,
): Promise<Dataset | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(datasets)
    .where(eq(datasets.id, datasetId));
  return row ? toDataset(row) : null;
}

/** A dataset, its logical model, and the builtin baseline version, created together. */
export async function ensureDataset(
  datasetId: string,
  db: Executor,
): Promise<Dataset> {
  const existing = await readDataset(datasetId, db);
  if (existing) return existing;
  const baseline = await ensureDatasetModel(datasetId, db);
  const [row] = await db
    .insert(datasets)
    .values({
      id: datasetId,
      modelId: datasetId,
      selectedModelVersionId: baseline.id,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (row) return toDataset(row);
  const current = await readDataset(datasetId, db);
  if (!current || current.modelId !== datasetId) {
    throw new Error(`Dataset ${datasetId} conflicts with another model`);
  }
  return current;
}

/**
 * Points the dataset at another version of its model. The dataset row lock
 * excludes prelabels being accepted for the previous version meanwhile.
 */
export async function selectModelVersion(
  datasetId: string,
  versionId: string,
): Promise<Dataset> {
  return transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(datasets)
      .where(eq(datasets.id, datasetId))
      .for("update");
    const current = locked ? toDataset(locked) : null;
    if (!current) throw new Error(`Unknown dataset: ${datasetId}`);
    const version = await readModelVersion(versionId, tx);
    if (!version) throw new Error(`Unknown model version: ${versionId}`);
    if (version.modelId !== current.modelId) {
      throw new Error(
        `Model version ${versionId} belongs to ${version.modelId}, not ${current.modelId}`,
      );
    }
    const [row] = await tx
      .update(datasets)
      .set({ selectedModelVersionId: versionId })
      .where(eq(datasets.id, datasetId))
      .returning();
    if (!row) throw new Error(`Unknown dataset: ${datasetId}`);
    return toDataset(row);
  });
}

export async function listDatasets(): Promise<string[]> {
  const db = await database();
  const rows = await db
    .select({ id: datasets.id })
    .from(datasets)
    .orderBy(asc(datasets.id));
  return rows.map((row) => row.id);
}

export async function listImages(
  datasetId: string,
  db?: Executor,
): Promise<DatasetImage[]> {
  const rows = await (db ?? (await database()))
    .select()
    .from(images)
    .where(eq(images.datasetId, datasetId))
    .orderBy(asc(images.stem));
  return rows.map(toDatasetImage);
}

export async function findImage(
  ref: ImageRef,
  db?: Executor,
): Promise<DatasetImage | null> {
  const { dataset, stem } = imageRefSchema.parse(ref);
  const [row] = await (db ?? (await database()))
    .select()
    .from(images)
    .where(and(eq(images.datasetId, dataset), eq(images.stem, stem)));
  return row ? toDatasetImage(row) : null;
}

/** Whether any image row or snapshot manifest still references the digest. */
async function digestReferenced(
  digest: string,
  db: Executor,
): Promise<boolean> {
  const [row] = await db
    .select({
      referenced: sql<boolean>`exists (select 1 from ${images} where ${images.digest} = ${digest})
        or exists (select 1 from ${datasetSnapshots} where ${datasetSnapshots.images} @> ${JSON.stringify([{ imageDigest: digest }])}::jsonb)`,
    })
    .from(sql`(select 1) as probe`);
  return row?.referenced ?? true;
}

/**
 * Removes the photograph together with everything derived from it; the bytes
 * go once nothing else shares them.
 */
export async function removeImage(ref: ImageRef): Promise<void> {
  const orphaned = await transaction(async (tx) => {
    const [row] = await tx
      .delete(images)
      .where(and(eq(images.datasetId, ref.dataset), eq(images.stem, ref.stem)))
      .returning({ digest: images.digest });
    if (!row) throw new Error(`No image ${ref.stem} in dataset ${ref.dataset}`);
    return (await digestReferenced(row.digest, tx)) ? null : row.digest;
  });
  if (orphaned) removeBlob(imageBlobKey(orphaned));
}
