import { and, eq, sql } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import {
  datasetImages,
  datasets,
  detectionFailures,
  detections,
  images,
  labels,
} from "../db/schema";
import {
  IMAGE_STATES,
  type ImageRef,
  type ImageState,
} from "../datasets/schema";
import type {
  DetectionFailure,
  DetectionResult,
  SeedQuality,
} from "../detection/schema";
import type { AnnotationDocument } from "../annotation/schema";
import {
  atRef,
  membershipOrder,
  sameMembership,
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
}

export interface DatasetSummary {
  dataset: string;
  imageCount: number;
  counts: Record<ImageState, number>;
}

/**
 * A dataset image with the documents that decide its state, loaded in one
 * query. The detection is the one a review started from once a label
 * exists, and the one under the dataset's selected version until then; the
 * failure is always the selected version's.
 */
export interface ImageRecord {
  image: DatasetImage;
  selectedModelVersionId: string;
  detection: DetectionResult | null;
  failure: DetectionFailure | null;
  label: AnnotationDocument | null;
}

/** An image whose review is complete; the label is present by construction. */
export interface ReviewedRecord extends ImageRecord {
  label: AnnotationDocument;
}

/** State follows from the documents: a worker's outcome, then a reviewer's label. */
function imageState({ detection, failure, label }: ImageRecord): ImageState {
  if (label) return label.status;
  if (detection) return "detected";
  return failure ? "failed" : "pending";
}

export function summarize(record: ImageRecord): ImageSummary {
  const { image, detection, failure, label } = record;
  return {
    dataset: image.dataset,
    digest: image.digest,
    filename: image.filename,
    state: imageState(record),
    detectionCount: detection?.instances.length ?? null,
    instanceCount: label?.instances.length ?? null,
    quality: detection?.quality ?? null,
    error: label || detection ? null : (failure?.error ?? null),
  };
}

/** The version whose detection the record shows. */
const shownVersion = sql`coalesce(${labels.sourceModelVersionId}, ${datasets.selectedModelVersionId})`;

/** Memberships with their images and the documents that decide their state. */
export function recordQuery(db: Executor) {
  return db
    .select({
      membership: datasetImages,
      image: images,
      selectedModelVersionId: datasets.selectedModelVersionId,
      detection: detections.document,
      failure: detectionFailures.document,
      label: labels.document,
    })
    .from(datasetImages)
    .innerJoin(images, eq(images.id, datasetImages.imageId))
    .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
    .leftJoin(labels, sameMembership(labels, datasetImages))
    .leftJoin(
      detections,
      and(
        eq(detections.imageId, datasetImages.imageId),
        eq(detections.modelVersionId, shownVersion),
      ),
    )
    .leftJoin(
      detectionFailures,
      and(
        eq(detectionFailures.imageId, datasetImages.imageId),
        eq(detectionFailures.modelVersionId, datasets.selectedModelVersionId),
      ),
    );
}

function toRecord(
  row: MembershipRow & {
    selectedModelVersionId: string;
    detection: DetectionResult | null;
    failure: DetectionFailure | null;
    label: AnnotationDocument | null;
  },
): ImageRecord {
  return {
    image: toDatasetImage(row),
    selectedModelVersionId: row.selectedModelVersionId,
    detection: row.detection,
    failure: row.failure,
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
 * operation that decides on the presence of a label takes this lock, so the
 * decision holds until it commits.
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
