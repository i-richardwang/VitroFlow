import { and, asc, count, eq, inArray } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import {
  datasetImages,
  datasetSnapshotImages,
  datasetSnapshots,
  images,
} from "../db/schema";
import {
  IMAGE_SPLITS,
  MIN_SNAPSHOT_IMAGES,
  datasetSnapshotSchema,
  type DatasetSnapshot,
  type ImageSplit,
} from "../training/schema";
import { contentDigest } from "./blobs";
import { readDataset } from "./datasets";
import { listReviewedRecords, type ReviewedRecord } from "./summaries";

/**
 * Gives every reviewed image a split it keeps across later snapshots, and
 * guarantees the set trains and validates on something.
 */
async function assignSplits(
  datasetId: string,
  reviewed: ReviewedRecord[],
  tx: Executor,
): Promise<Map<string, ImageSplit>> {
  const splits = new Map<string, ImageSplit>();
  const assignedNow: ReviewedRecord[] = [];
  for (const record of reviewed) {
    if (record.image.split) {
      splits.set(record.image.digest, record.image.split);
      continue;
    }
    const bucket =
      Number.parseInt(contentDigest(record.image.digest).slice(0, 8), 16) /
      0xffffffff;
    splits.set(record.image.digest, bucket < 0.2 ? "val" : "train");
    assignedNow.push(record);
  }
  const extreme = (direction: 1 | -1) =>
    [...assignedNow].sort(
      (a, b) =>
        direction *
        contentDigest(a.image.digest).localeCompare(
          contentDigest(b.image.digest),
        ),
    )[0];
  for (const split of ["val", "train"] as const) {
    if ([...splits.values()].includes(split)) continue;
    const record = extreme(split === "val" ? 1 : -1);
    if (!record) {
      throw new Error(
        `Stable split has no ${split === "val" ? "validation" : "training"} image; add another reviewed image`,
      );
    }
    splits.set(record.image.digest, split);
  }
  for (const split of IMAGE_SPLITS) {
    const digests = assignedNow
      .filter((record) => splits.get(record.image.digest) === split)
      .map((record) => record.image.digest);
    if (digests.length === 0) continue;
    await tx
      .update(datasetImages)
      .set({ split })
      .where(
        and(
          eq(datasetImages.datasetId, datasetId),
          inArray(datasetImages.imageId, digests),
        ),
      );
  }
  return splits;
}

async function snapshotImages(snapshotId: string, db: Executor) {
  return db
    .select({
      digest: datasetSnapshotImages.imageId,
      extension: images.extension,
      split: datasetSnapshotImages.split,
      annotation: datasetSnapshotImages.annotation,
    })
    .from(datasetSnapshotImages)
    .innerJoin(images, eq(images.id, datasetSnapshotImages.imageId))
    .where(eq(datasetSnapshotImages.snapshotId, snapshotId))
    .orderBy(asc(datasetSnapshotImages.imageId));
}

export async function readDatasetSnapshot(
  snapshotId: string,
  db?: Executor,
): Promise<DatasetSnapshot | null> {
  const executor = db ?? (await database());
  const [row] = await executor
    .select()
    .from(datasetSnapshots)
    .where(eq(datasetSnapshots.id, snapshotId));
  if (!row) return null;
  return datasetSnapshotSchema.parse({
    schemaVersion: 1,
    id: row.id,
    datasetId: row.datasetId,
    modelId: row.modelId,
    createdAt: row.createdAt.toISOString(),
    images: await snapshotImages(snapshotId, executor),
  });
}

/**
 * Freezes the complete annotations into a snapshot named by their content.
 * Images are referenced, not copied: the snapshot rows keep the bytes alive.
 * An identical set returns the existing snapshot.
 */
export async function createDatasetSnapshot(
  datasetId: string,
  tx: Executor,
): Promise<DatasetSnapshot> {
  const dataset = await readDataset(datasetId, tx);
  if (!dataset) throw new Error(`Unknown dataset: ${datasetId}`);
  const reviewed = await listReviewedRecords(datasetId, tx, true);
  if (reviewed.length < MIN_SNAPSHOT_IMAGES) {
    throw new Error(
      `Training requires at least ${MIN_SNAPSHOT_IMAGES} complete annotations`,
    );
  }
  const splits = await assignSplits(datasetId, reviewed, tx);
  const members = reviewed
    .map(({ image, label }) => {
      const split = splits.get(image.digest);
      if (!split) throw new Error(`Image ${image.digest} has no split`);
      return { digest: image.digest, split, annotation: label };
    })
    .sort((a, b) => a.digest.localeCompare(b.digest));
  const snapshotId = `snapshot-${contentDigest(
    JSON.stringify({ datasetId, modelId: dataset.modelId, members }),
  )}`;
  const existing = await readDatasetSnapshot(snapshotId, tx);
  if (existing) return existing;
  await tx.insert(datasetSnapshots).values({
    id: snapshotId,
    datasetId,
    modelId: dataset.modelId,
    createdAt: new Date(),
  });
  await tx.insert(datasetSnapshotImages).values(
    members.map(({ digest, split, annotation }) => ({
      snapshotId,
      imageId: digest,
      split,
      annotation,
    })),
  );
  const created = await readDatasetSnapshot(snapshotId, tx);
  if (!created) throw new Error(`Snapshot ${snapshotId} was not created`);
  return created;
}

/** How many reviewed images each snapshot froze. */
export async function snapshotImageCounts(
  snapshotIds: string[],
): Promise<Map<string, number>> {
  if (snapshotIds.length === 0) return new Map();
  const db = await database();
  const rows = await db
    .select({ id: datasetSnapshotImages.snapshotId, count: count() })
    .from(datasetSnapshotImages)
    .where(inArray(datasetSnapshotImages.snapshotId, snapshotIds))
    .groupBy(datasetSnapshotImages.snapshotId);
  return new Map(rows.map((row) => [row.id, row.count]));
}
