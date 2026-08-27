import { and, asc, eq } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import { images, labels, prelabels } from "../db/schema";
import {
  IMAGE_STATES,
  type ImageRef,
  type ImageState,
} from "../datasets/schema";
import {
  isFailure,
  prelabelSchema,
  type Prelabel,
  type SeedQuality,
} from "../detection/schema";
import {
  annotationSchema,
  type AnnotationDocument,
} from "../annotation/schema";
import { toDatasetImage, type DatasetImage } from "./datasets";

export interface ImageSummary extends ImageRef {
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

/** An image with both documents that decide its state, loaded in one query. */
export interface ImageRecord {
  image: DatasetImage;
  prelabel: Prelabel | null;
  label: AnnotationDocument | null;
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
    stem: image.stem,
    state: imageState(record),
    detectionCount: detected?.instances.length ?? null,
    instanceCount: label?.instances.length ?? null,
    quality: detected?.quality ?? null,
    error: prelabel && isFailure(prelabel) ? prelabel.error : null,
    modelVersionId: prelabel?.producer.model_version_id ?? null,
  };
}

function imageQuery(db: Executor) {
  return db
    .select({
      image: images,
      prelabel: prelabels.document,
      label: labels.document,
    })
    .from(images)
    .leftJoin(
      prelabels,
      and(
        eq(prelabels.datasetId, images.datasetId),
        eq(prelabels.stem, images.stem),
      ),
    )
    .leftJoin(
      labels,
      and(eq(labels.datasetId, images.datasetId), eq(labels.stem, images.stem)),
    );
}

function toRecord(row: {
  image: typeof images.$inferSelect;
  prelabel: Prelabel | null;
  label: AnnotationDocument | null;
}): ImageRecord {
  return {
    image: toDatasetImage(row.image),
    prelabel: row.prelabel ? prelabelSchema.parse(row.prelabel) : null,
    label: row.label ? annotationSchema.parse(row.label) : null,
  };
}

export async function listImageRecords(
  datasetId: string,
  db?: Executor,
): Promise<ImageRecord[]> {
  const rows = await imageQuery(db ?? (await database()))
    .where(eq(images.datasetId, datasetId))
    .orderBy(asc(images.stem));
  return rows.map(toRecord);
}

/** Images whose review is complete, the only ones training may use. */
export async function listReviewedRecords(
  datasetId: string,
  db: Executor,
  lockImages = false,
): Promise<ImageRecord[]> {
  const query = imageQuery(db)
    .where(and(eq(images.datasetId, datasetId), eq(labels.status, "complete")))
    .orderBy(asc(images.stem));
  const rows = lockImages
    ? await query.for("share", { of: images })
    : await query;
  return rows.map(toRecord);
}

export async function readImageRecord(
  ref: ImageRef,
  db?: Executor,
): Promise<ImageRecord | null> {
  const [row] = await imageQuery(db ?? (await database())).where(
    and(eq(images.datasetId, ref.dataset), eq(images.stem, ref.stem)),
  );
  return row ? toRecord(row) : null;
}

/**
 * The record with its image row locked for the transaction. Every operation
 * that decides on the presence of a prelabel or label takes this lock, so the
 * decision holds until it commits.
 */
export async function lockImageRecord(
  ref: ImageRef,
  tx: Executor,
): Promise<ImageRecord | null> {
  const [row] = await imageQuery(tx)
    .where(and(eq(images.datasetId, ref.dataset), eq(images.stem, ref.stem)))
    .for("update", { of: images });
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
