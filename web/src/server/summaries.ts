import { and, eq, sql, type SQLWrapper } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import {
  datasetImages,
  datasets,
  images,
  inferenceOutcomes,
  annotations,
} from "../db/schema";
import {
  IMAGE_STATES,
  type DatasetImageRef,
  type ImageState,
} from "../datasets/schema";
import type { DetectionQuality, DetectionResult } from "../detection/schema";
import type { AnnotationDocument } from "../annotation/schema";
import {
  membershipOrder,
  toDatasetImage,
  type DatasetImage,
  type MembershipRow,
} from "./datasets";

export interface ImageSummary extends DatasetImageRef {
  filename: string;
  state: ImageState;
  detectionCount: number | null;
  instanceCount: number | null;
  quality: DetectionQuality | null;
}

export interface DatasetSummary {
  dataset: string;
  modelId: string;
  imageCount: number;
  counts: Record<ImageState, number>;
}

/**
 * A dataset image with the documents that decide its state, loaded in one
 * query. The annotation is the review for the dataset's model; the detection is
 * the one that review started from, or the model's newest for the image
 * until a review exists.
 */
export interface ImageRecord {
  image: DatasetImage;
  modelId: string;
  detection: DetectionResult | null;
  annotation: AnnotationDocument | null;
}

/** An image whose review is complete; the annotation is present by construction. */
export interface ReviewedRecord extends ImageRecord {
  annotation: AnnotationDocument;
}

export function summarize(record: ImageRecord): ImageSummary {
  const { image, detection, annotation } = record;
  return {
    dataset: image.dataset,
    digest: image.digest,
    filename: image.filename,
    state: annotation?.status ?? "unreviewed",
    detectionCount: detection?.instances.length ?? null,
    instanceCount: annotation?.instances.length ?? null,
    quality: detection?.quality ?? null,
  };
}

/**
 * The version whose detection an image shows for a model: the one its review
 * started from, otherwise the newest of the model's versions that has
 * detected it.
 */
export function shownVersion(
  imageId: SQLWrapper,
  modelId: SQLWrapper | string,
) {
  return sql`coalesce(${annotations.sourceModelVersionId}, (
    select d.model_version_id
    from inference_outcomes d
    join model_versions v on v.id = d.model_version_id
    where d.image_id = ${imageId} and v.model_id = ${modelId}
    order by v.created_at desc, v.id desc
    limit 1
  ))`;
}

/** Memberships with their images and the documents that decide their state. */
export function recordQuery(db: Executor) {
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
          shownVersion(datasetImages.imageId, datasets.modelId),
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
        eq(annotations.status, "complete"),
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
  modelId: string,
): Promise<DatasetSummary> {
  const images = (await listImageRecords(datasetId)).map(summarize);
  return {
    dataset: datasetId,
    modelId,
    imageCount: images.length,
    counts: countImageStates(images),
  };
}
