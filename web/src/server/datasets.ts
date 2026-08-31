import { and, asc, eq, or, type Column } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  datasetImages,
  datasets,
  experimentPhotos,
  experiments,
  images,
  modelVersions,
} from "../db/schema";
import {
  datasetSchema,
  type Dataset,
  type DatasetImageRef,
  type DatasetPhotoAddition,
} from "../datasets/schema";
import type { PhotoRef } from "../experiments/schema";
import type { ImageSplit } from "../training/schema";
import { imageBlobKey } from "./blobs";
import { lockImage } from "./image-lock";

/** An image as seen through its membership in one dataset. */
export interface DatasetImage extends DatasetImageRef {
  filename: string;
  width: number;
  height: number;
  bytes: number;
  /** Where the bytes live, by content digest. */
  blobKey: string;
  split: ImageSplit | null;
}

export interface DatasetPhotoAdditionResult {
  dataset: Dataset;
  added: number;
  existing: number;
}

/** Thrown when a reference names no experiment photograph. */
export class NotPhotographedError extends Error {}

/** Thrown when photographs would join a dataset training another model. */
export class DatasetModelError extends Error {}

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

/** Membership creation time, then filename and digest. */
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
export function atRef(
  table: MembershipKeyed,
  { dataset, digest }: DatasetImageRef,
) {
  return and(eq(table.datasetId, dataset), eq(table.imageId, digest));
}

export function notInDataset(ref: DatasetImageRef): Error {
  return new Error(`Image ${ref.digest} is not in dataset ${ref.dataset}`);
}

function toDataset(row: typeof datasets.$inferSelect): Dataset {
  return datasetSchema.parse({
    id: row.id,
    modelId: row.modelId,
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

export async function listDatasets(db?: Executor): Promise<Dataset[]> {
  const rows = await (db ?? (await database()))
    .select()
    .from(datasets)
    .orderBy(asc(datasets.id));
  return rows.map(toDataset);
}

/** Datasets whose reviews train one model. */
export async function listDatasetsForModel(
  modelId: string,
  db?: Executor,
): Promise<Dataset[]> {
  const rows = await (db ?? (await database()))
    .select()
    .from(datasets)
    .where(eq(datasets.modelId, modelId))
    .orderBy(asc(datasets.id));
  return rows.map(toDataset);
}

/** The dataset, created for the model if it does not exist yet. */
async function ensureDataset(
  datasetId: string,
  modelId: string,
  db: Executor,
): Promise<Dataset> {
  const existing = await readDataset(datasetId, db);
  if (existing) {
    if (existing.modelId !== modelId) {
      throw new DatasetModelError(
        `Dataset ${datasetId} trains ${existing.modelId}, not ${modelId}`,
      );
    }
    return existing;
  }
  const [row] = await db
    .insert(datasets)
    .values({ id: datasetId, modelId, createdAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (row) return toDataset(row);
  return ensureDataset(datasetId, modelId, db);
}

function describePhoto({ experiment, dish, round }: PhotoRef): string {
  return `${experiment}/${dish}/${round}`;
}

function atPhoto({ experiment, dish, round }: PhotoRef) {
  return and(
    eq(experimentPhotos.experimentId, experiment),
    eq(experimentPhotos.dishLabel, dish),
    eq(experimentPhotos.roundId, round),
  );
}

/**
 * Adds experiment photographs to a dataset of the model their experiments
 * reads with, creating the dataset on first use. Each joins under the
 * filename it was photographed as; a photograph taken in several places joins
 * once, under the first reference. The sorted digest locks serialize the
 * addition with image collection, and the dataset gains every photograph or
 * none.
 */
export async function addExperimentPhotos(
  value: DatasetPhotoAddition,
): Promise<DatasetPhotoAdditionResult> {
  const { dataset: datasetId, photos } = value;
  const addedAt = new Date();
  return transaction(async (tx) => {
    const photographed = await tx
      .select({
        experimentId: experimentPhotos.experimentId,
        dishLabel: experimentPhotos.dishLabel,
        roundId: experimentPhotos.roundId,
        digest: experimentPhotos.imageId,
        filename: experimentPhotos.filename,
        modelId: modelVersions.modelId,
      })
      .from(experimentPhotos)
      .innerJoin(experiments, eq(experiments.id, experimentPhotos.experimentId))
      .innerJoin(
        modelVersions,
        eq(modelVersions.id, experiments.modelVersionId),
      )
      .where(or(...photos.map(atPhoto)));
    const byRef = new Map(
      photographed.map((row) => [
        describePhoto({
          experiment: row.experimentId,
          dish: row.dishLabel,
          round: row.roundId,
        }),
        row,
      ]),
    );
    const missing = photos.filter((photo) => !byRef.has(describePhoto(photo)));
    if (missing.length > 0) {
      throw new NotPhotographedError(
        `Not experiment photographs: ${missing.map(describePhoto).join(", ")}`,
      );
    }
    const resolved = photos.map((photo) => byRef.get(describePhoto(photo))!);
    const modelIds = [...new Set(resolved.map((row) => row.modelId))];
    if (modelIds.length > 1) {
      throw new DatasetModelError(
        `The photographs were read with different models: ${modelIds.join(", ")}`,
      );
    }
    const joining = new Map<string, string>();
    for (const row of resolved) {
      if (!joining.has(row.digest)) joining.set(row.digest, row.filename);
    }
    const dataset = await ensureDataset(datasetId, modelIds[0]!, tx);
    const sorted = [...joining.keys()].sort();
    for (const digest of sorted) await lockImage(digest, tx);
    const created = await tx
      .insert(datasetImages)
      .values(
        sorted.map((digest) => ({
          datasetId,
          imageId: digest,
          filename: joining.get(digest)!,
          addedAt,
        })),
      )
      .onConflictDoNothing()
      .returning({ imageId: datasetImages.imageId });
    return {
      dataset,
      added: created.length,
      existing: sorted.length - created.length,
    };
  });
}

/**
 * Removes the image from the dataset. Its review belongs to the image and
 * the model, so it survives; the photograph outlives the membership too.
 */
export async function removeDatasetImage(ref: DatasetImageRef): Promise<void> {
  const [membership] = await (
    await database()
  )
    .delete(datasetImages)
    .where(atRef(datasetImages, ref))
    .returning({ imageId: datasetImages.imageId });
  if (!membership) throw notInDataset(ref);
}
