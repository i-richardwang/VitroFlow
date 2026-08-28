import { and, asc, eq, notExists, sql, type Column } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  datasetImages,
  datasetSnapshotImages,
  datasets,
  images,
} from "../db/schema";
import { datasetSchema, type Dataset, type ImageRef } from "../datasets/schema";
import type { ImageSplit } from "../training/schema";
import { imageBlobKey } from "./blobs";
import { ensureDatasetModel, readModelVersion } from "./model-registry";

/** An image as seen through its membership in one dataset. */
export interface DatasetImage extends ImageRef {
  filename: string;
  width: number;
  height: number;
  bytes: number;
  /** Where the bytes live, by content digest. */
  blobKey: string;
  split: ImageSplit | null;
}

export type MembershipRow = {
  membership: typeof datasetImages.$inferSelect;
  image: typeof images.$inferSelect;
};

export function toDatasetImage({
  membership,
  image,
}: MembershipRow): DatasetImage {
  return {
    dataset: membership.datasetId,
    digest: image.id,
    filename: membership.filename,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    blobKey: imageBlobKey(image.id),
    split: membership.split,
  };
}

/** Memberships joined to their images. */
export function membershipQuery(db: Executor) {
  return db
    .select({ membership: datasetImages, image: images })
    .from(datasetImages)
    .innerJoin(images, eq(images.id, datasetImages.imageId));
}

/** Upload order, then name within one upload. */
export function membershipOrder() {
  return [
    asc(datasetImages.addedAt),
    asc(datasetImages.filename),
    asc(datasetImages.imageId),
  ];
}

/** Every table keyed by a membership carries these two columns. */
interface MembershipKeyed {
  datasetId: Column;
  imageId: Column;
}

/** The row of `table` that belongs to one membership. */
export function atRef(table: MembershipKeyed, { dataset, digest }: ImageRef) {
  return and(eq(table.datasetId, dataset), eq(table.imageId, digest));
}

/** Joins two membership-keyed tables on the same membership. */
export function sameMembership(left: MembershipKeyed, right: MembershipKeyed) {
  return and(
    eq(left.datasetId, right.datasetId),
    eq(left.imageId, right.imageId),
  );
}

export function describeRef({ dataset, digest }: ImageRef): string {
  return `${dataset}/${digest}`;
}

export function notInDataset(ref: ImageRef): Error {
  return new Error(`Image ${ref.digest} is not in dataset ${ref.dataset}`);
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
  const rows = await membershipQuery(db ?? (await database()))
    .where(eq(datasetImages.datasetId, datasetId))
    .orderBy(...membershipOrder());
  return rows.map(toDatasetImage);
}

export async function findImage(
  ref: ImageRef,
  db?: Executor,
): Promise<DatasetImage | null> {
  const [row] = await membershipQuery(db ?? (await database())).where(
    atRef(datasetImages, ref),
  );
  return row ? toDatasetImage(row) : null;
}

/**
 * Removes the image from the dataset together with its review documents.
 * The image row goes once no dataset or snapshot refers to it; the foreign
 * keys make any other outcome impossible. Its bytes stay until
 * `collectUnreferencedImages` runs.
 */
export async function removeImage(ref: ImageRef): Promise<void> {
  await transaction(async (tx) => {
    const [membership] = await tx
      .delete(datasetImages)
      .where(atRef(datasetImages, ref))
      .returning({ imageId: datasetImages.imageId });
    if (!membership) throw notInDataset(ref);
    await tx.delete(images).where(
      and(
        eq(images.id, membership.imageId),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(datasetImages)
            .where(eq(datasetImages.imageId, images.id)),
        ),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(datasetSnapshotImages)
            .where(eq(datasetSnapshotImages.imageId, images.id)),
        ),
      ),
    );
  });
}
