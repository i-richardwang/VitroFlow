import { and, eq } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import { datasetImages, images, labels, prelabels } from "../db/schema";
import {
  IMAGE_STATES,
  type ImageRef,
  type ImageState,
} from "../datasets/schema";
import {
  isFailure,
  type Prelabel,
  type SeedQuality,
} from "../detection/schema";
import type { AnnotationDocument } from "../annotation/schema";
import {
  atRef,
  membershipOrder,
  membershipQuery,
  toDatasetImage,
  type DatasetImage,
  type MembershipRow,
} from "./datasets";

export interface ImageSummary extends ImageRef {
  filename: string;
  state: ImageState;
  detectionCount: number | null;
  instanceCount: number | null;
  quality: SeedQuality | null;
  error: string | null;
  /** The model version that produced the prelabel, if one exists. */
  modelVersionId: string | null;
}

export interface DatasetSummary {
  dataset: string;
  imageCount: number;
  counts: Record<ImageState, number>;
}

/** A dataset image with both documents that decide its state, loaded in one query. */
export interface ImageRecord {
  image: DatasetImage;
  prelabel: Prelabel | null;
  label: AnnotationDocument | null;
}

/** An image whose review is complete; the label is present by construction. */
export interface ReviewedRecord extends ImageRecord {
  label: AnnotationDocument;
}

/** State follows from the documents: a worker's prelabel, then a reviewer's label. */
function imageState({ prelabel, label }: ImageRecord): ImageState {
  if (label) return label.status;
  if (prelabel === null) return "pending";
  return isFailure(prelabel) ? "failed" : "prelabeled";
}

export function summarize(record: ImageRecord): ImageSummary {
  const { image, prelabel, label } = record;
  const detected = prelabel && !isFailure(prelabel) ? prelabel : null;
  return {
    dataset: image.dataset,
    digest: image.digest,
    filename: image.filename,
    state: imageState(record),
    detectionCount: detected?.instances.length ?? null,
    instanceCount: label?.instances.length ?? null,
    quality: detected?.quality ?? null,
    error: prelabel && isFailure(prelabel) ? prelabel.error : null,
    modelVersionId: prelabel?.producer.model_version_id ?? null,
  };
}

/** Memberships with their images and both review documents. */
export function recordQuery(db: Executor) {
  return db
    .select({
      membership: datasetImages,
      image: images,
      prelabel: prelabels.document,
      label: labels.document,
    })
    .from(datasetImages)
    .innerJoin(images, eq(images.id, datasetImages.imageId))
    .leftJoin(
      prelabels,
      and(
        eq(prelabels.datasetId, datasetImages.datasetId),
        eq(prelabels.imageId, datasetImages.imageId),
      ),
    )
    .leftJoin(
      labels,
      and(
        eq(labels.datasetId, datasetImages.datasetId),
        eq(labels.imageId, datasetImages.imageId),
      ),
    );
}

function toRecord(
  row: MembershipRow & {
    prelabel: Prelabel | null;
    label: AnnotationDocument | null;
  },
): ImageRecord {
  return {
    image: toDatasetImage(row),
    prelabel: row.prelabel,
    label: row.label,
  };
}

export async function listImageRecords(
  datasetId: string,
  db?: Executor,
): Promise<ImageRecord[]> {
  const rows = await recordQuery(db ?? (await database()))
    .where(eq(datasetImages.datasetId, datasetId))
    .orderBy(...membershipOrder());
  return rows.map(toRecord);
}

/**
 * Images whose review is complete, the only ones training may use. With
 * `lock`, the memberships are share-locked so a removal waits for the
 * caller's transaction.
 */
export async function listReviewedRecords(
  datasetId: string,
  db: Executor,
  lock = false,
): Promise<ReviewedRecord[]> {
  const query = recordQuery(db)
    .where(
      and(
        eq(datasetImages.datasetId, datasetId),
        eq(labels.status, "complete"),
      ),
    )
    .orderBy(...membershipOrder());
  const rows = lock
    ? await query.for("share", { of: datasetImages })
    : await query;
  return rows
    .map(toRecord)
    .flatMap((record) =>
      record.label ? [{ ...record, label: record.label }] : [],
    );
}

export async function readImageRecord(
  ref: ImageRef,
  db?: Executor,
): Promise<ImageRecord | null> {
  const [row] = await recordQuery(db ?? (await database())).where(
    atRef(datasetImages, ref),
  );
  return row ? toRecord(row) : null;
}

/**
 * The record with its membership row locked for the transaction. Every
 * operation that decides on the presence of a prelabel or label takes this
 * lock, so the decision holds until it commits.
 */
export async function lockImageRecord(
  ref: ImageRef,
  tx: Executor,
): Promise<ImageRecord | null> {
  const [row] = await recordQuery(tx)
    .where(atRef(datasetImages, ref))
    .for("update", { of: datasetImages });
  return row ? toRecord(row) : null;
}

export function countImageStates(
  images: ImageSummary[],
): Record<ImageState, number> {
  const counts = Object.fromEntries(
    IMAGE_STATES.map((state) => [state, 0]),
  ) as Record<ImageState, number>;
  for (const image of images) {
    counts[image.state] += 1;
  }
  return counts;
}

export async function summarizeDataset(
  datasetId: string,
): Promise<DatasetSummary> {
  const images = (await listImageRecords(datasetId)).map(summarize);
  return {
    dataset: datasetId,
    imageCount: images.length,
    counts: countImageStates(images),
  };
}
