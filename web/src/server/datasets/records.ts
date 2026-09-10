import { newestDetectingVersion } from "../inference/public";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { database, type Executor } from "../infra/db/client";
import {
  datasetImages,
  datasets,
  images,
  inferenceOutcomes,
  annotations,
} from "../infra/db/schema";
import type { DatasetImageRef } from "../../domain/datasets/schema";
import type { AnnotationDocument } from "../../domain/annotation/schema";
import type {
  DetectionQuality,
  DetectionResult,
} from "../../domain/detection/schema";
import {
  membershipOrder,
  toDatasetImage,
  type DatasetImage,
  type MembershipRow,
} from "./memberships";

export interface ImageSummary extends DatasetImageRef {
  filename: string;
  /** Boxes of the newest detection, or null until a version has run. */
  detectionCount: number | null;
  /** Boxes of the stored review, or null until someone has reviewed the image. */
  instanceCount: number | null;
  quality: DetectionQuality | null;
}

interface DatasetSummary {
  dataset: string;
  modelId: string;
  imageCount: number;
  reviewedCount: number;
}

/**
 * A dataset image with the documents that decide its state, loaded in one
 * query. The annotation is the review for the dataset's model; the detection
 * is the newest the model's versions recorded for the image.
 */
export interface ImageRecord {
  image: DatasetImage;
  modelId: string;
  detection: DetectionResult | null;
  annotation: AnnotationDocument | null;
}

/** An image that has been reviewed; the annotation is present by construction. */
export interface ReviewedRecord extends ImageRecord {
  annotation: AnnotationDocument;
}

export function summarize(record: ImageRecord): ImageSummary {
  const { image, detection, annotation } = record;
  return {
    dataset: image.dataset,
    digest: image.digest,
    filename: image.filename,
    detectionCount: detection?.instances.length ?? null,
    instanceCount: annotation?.instances.length ?? null,
    quality: detection?.quality ?? null,
  };
}

/** Memberships with their images and the documents that decide their state. */
function recordQuery(db: Executor) {
  return db
    .select({
      membership: datasetImages,
      image: images,
      modelId: datasets.modelId,
      detection: sql<DetectionResult | null>`${inferenceOutcomes.document}`,
      annotation: annotations.document,
    })
    .from(datasetImages)
    .innerJoin(images, eq(images.id, datasetImages.imageId))
    .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, datasetImages.imageId),
        eq(annotations.modelId, datasets.modelId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, datasetImages.imageId),
        eq(
          inferenceOutcomes.modelVersionId,
          newestDetectingVersion(datasetImages.imageId, datasets.modelId),
        ),
        eq(inferenceOutcomes.status, "succeeded"),
      ),
    );
}

function toRecord(
  row: MembershipRow & {
    modelId: string;
    detection: DetectionResult | null;
    annotation: AnnotationDocument | null;
  },
): ImageRecord {
  return {
    image: toDatasetImage(row),
    modelId: row.modelId,
    detection: row.detection,
    annotation: row.annotation,
  };
}

export async function listImageRecords(
  datasetId: string,
): Promise<ImageRecord[]> {
  const rows = await recordQuery(await database())
    .where(eq(datasetImages.datasetId, datasetId))
    .orderBy(...membershipOrder());
  return rows.map(toRecord);
}

/**
 * Images that have been reviewed, the only ones training may use. With
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
        isNotNull(annotations.imageId),
      ),
    )
    .orderBy(...membershipOrder());
  const rows = lock
    ? await query.for("share", { of: datasetImages })
    : await query;
  return rows
    .map(toRecord)
    .flatMap((record) =>
      record.annotation ? [{ ...record, annotation: record.annotation }] : [],
    );
}

export function countReviewed(records: ImageRecord[]): number {
  return records.filter((record) => record.annotation !== null).length;
}

export async function summarizeDataset(
  datasetId: string,
  modelId: string,
): Promise<DatasetSummary> {
  const records = await listImageRecords(datasetId);
  return {
    dataset: datasetId,
    modelId,
    imageCount: records.length,
    reviewedCount: countReviewed(records),
  };
}
