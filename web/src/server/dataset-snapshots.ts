import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import { datasetSnapshots, images } from "../db/schema";
import {
  IMAGE_SPLITS,
  MIN_SNAPSHOT_IMAGES,
  datasetSnapshotSchema,
  type DatasetSnapshot,
  type ImageSplit,
} from "../training/schema";
import { imageBlobKey } from "./blobs";
import { readDataset } from "./datasets";
import { listReviewedRecords, type ImageRecord } from "./summaries";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSnapshot(
  row: typeof datasetSnapshots.$inferSelect,
): DatasetSnapshot {
  return datasetSnapshotSchema.parse({
    schemaVersion: 1,
    id: row.id,
    datasetId: row.datasetId,
    modelId: row.modelId,
    createdAt: row.createdAt.toISOString(),
    images: row.images,
  });
}

/**
 * Gives every reviewed image a split it keeps across later snapshots, and
 * guarantees the set trains and validates on something.
 */
async function assignSplits(
  datasetId: string,
  reviewed: ImageRecord[],
  tx: Executor,
): Promise<Map<string, ImageSplit>> {
  const splits = new Map<string, ImageSplit>();
  const assignedNow: ImageRecord[] = [];
  for (const record of reviewed) {
    if (record.image.split) {
      splits.set(record.image.source, record.image.split);
      continue;
    }
    const bucket =
      Number.parseInt(digest(record.image.source).slice(0, 8), 16) / 0xffffffff;
    splits.set(record.image.source, bucket < 0.2 ? "val" : "train");
    assignedNow.push(record);
  }
  const bySource = (direction: 1 | -1) =>
    [...assignedNow].sort(
      (a, b) =>
        direction *
        digest(a.image.source).localeCompare(digest(b.image.source)),
    )[0];
  for (const split of ["val", "train"] as const) {
    if ([...splits.values()].includes(split)) continue;
    const record = bySource(split === "val" ? 1 : -1);
    if (!record) {
      throw new Error(
        `Stable split has no ${split === "val" ? "validation" : "training"} image; add another reviewed image`,
      );
    }
    splits.set(record.image.source, split);
  }
  for (const split of IMAGE_SPLITS) {
    const stems = assignedNow
      .filter((record) => splits.get(record.image.source) === split)
      .map((record) => record.image.stem);
    if (stems.length === 0) continue;
    await tx
      .update(images)
      .set({ split })
      .where(and(eq(images.datasetId, datasetId), inArray(images.stem, stems)));
  }
  return splits;
}

export async function readDatasetSnapshot(
  snapshotId: string,
  db?: Executor,
): Promise<DatasetSnapshot | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(datasetSnapshots)
    .where(eq(datasetSnapshots.id, snapshotId));
  return row ? toSnapshot(row) : null;
}

/**
 * Freezes the complete annotations into a content-addressed snapshot; images
 * are referenced by digest, so the manifest alone pins the bytes. An identical
 * set returns the existing snapshot.
 */
export async function createDatasetSnapshot(
  datasetId: string,
  tx: Executor,
): Promise<DatasetSnapshot> {
  const dataset = await readDataset(datasetId, tx);
  if (!dataset) throw new Error(`Unknown dataset: ${datasetId}`);
  // Keep image rows alive until the manifest commits. Deletion takes an
  // exclusive lock and will then see the snapshot reference before deciding
  // whether its content-addressed blob can be collected.
  const reviewed = await listReviewedRecords(datasetId, tx, true);
  if (reviewed.length < MIN_SNAPSHOT_IMAGES) {
    throw new Error(
      `Training requires at least ${MIN_SNAPSHOT_IMAGES} complete annotations`,
    );
  }
  const splits = await assignSplits(datasetId, reviewed, tx);
  const snapshotImages = reviewed.map(({ image, label }, index) => ({
    ref: { dataset: image.dataset, stem: image.stem },
    source: image.source,
    artifactPath: `images/${index}${image.extension}`,
    imageDigest: image.digest,
    split: splits.get(image.source),
    annotation: label,
  }));
  const identity = digest(
    JSON.stringify({
      datasetId,
      modelId: dataset.modelId,
      images: snapshotImages,
    }),
  );
  const snapshot = datasetSnapshotSchema.parse({
    schemaVersion: 1,
    id: `snapshot-${identity}`,
    datasetId,
    modelId: dataset.modelId,
    createdAt: new Date().toISOString(),
    images: snapshotImages,
  });
  const existing = await readDatasetSnapshot(snapshot.id, tx);
  if (existing) return existing;
  await tx.insert(datasetSnapshots).values({
    id: snapshot.id,
    datasetId: snapshot.datasetId,
    modelId: snapshot.modelId,
    createdAt: new Date(snapshot.createdAt),
    images: snapshot.images,
  });
  return snapshot;
}

export async function snapshotImage(
  snapshotId: string,
  index: number,
): Promise<{ key: string; digest: string } | null> {
  const snapshot = await readDatasetSnapshot(snapshotId);
  const image = snapshot?.images[index];
  if (!snapshot || !image) return null;
  return { key: imageBlobKey(image.imageDigest), digest: image.imageDigest };
}

/** How many reviewed images each snapshot froze, without loading the manifests. */
export async function snapshotImageCounts(
  snapshotIds: string[],
): Promise<Map<string, number>> {
  if (snapshotIds.length === 0) return new Map();
  const db = await database();
  const rows = await db
    .select({
      id: datasetSnapshots.id,
      count:
        sql<number>`jsonb_array_length(${datasetSnapshots.images})`.mapWith(
          Number,
        ),
    })
    .from(datasetSnapshots)
    .where(inArray(datasetSnapshots.id, snapshotIds));
  return new Map(rows.map((row) => [row.id, row.count]));
}
