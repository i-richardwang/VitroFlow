import { and, eq, sql } from "drizzle-orm";

import type { AnnotationDocument, LabelRef } from "../annotation/schema";
import { database, type Executor } from "../db/client";
import { detections, images, labels } from "../db/schema";
import type { DetectionResult } from "../detection/schema";
import type { Model } from "../models/schema";
import { imageFilenames } from "./image-names";
import { readModel, readModelVersion } from "./model-registry";
import { shownVersion } from "./summaries";

/**
 * Everything the review workbench needs for one image and one model: the
 * review if it has started, and otherwise the detection it would start from.
 */
export interface Review {
  ref: LabelRef;
  model: Model;
  filename: string;
  width: number;
  height: number;
  detection: DetectionResult | null;
  label: AnnotationDocument | null;
}

/**
 * A review that has started shows the detection it started from. Before
 * that, it shows the detection of `versionId` when the reviewer arrived from
 * a count of that version, so the boxes are the ones they just looked at;
 * otherwise the newest of the model's versions that has detected the image.
 * A version of another model names no review.
 */
export async function readReview(
  ref: LabelRef,
  versionId?: string,
  db?: Executor,
): Promise<Review | null> {
  const executor = db ?? (await database());
  const model = await readModel(ref.model, executor);
  if (!model) return null;
  if (versionId !== undefined) {
    const version = await readModelVersion(versionId, executor);
    if (version?.modelId !== ref.model) return null;
  }
  const shown =
    versionId === undefined
      ? shownVersion(images.id, ref.model)
      : sql`coalesce(${labels.sourceModelVersionId}, ${versionId})`;
  const [row] = await executor
    .select({
      image: images,
      detection: detections.document,
      label: labels.document,
    })
    .from(images)
    .leftJoin(
      labels,
      and(eq(labels.imageId, images.id), eq(labels.modelId, ref.model)),
    )
    .leftJoin(
      detections,
      and(
        eq(detections.imageId, images.id),
        eq(detections.modelVersionId, shown),
      ),
    )
    .where(eq(images.id, ref.digest));
  if (!row) return null;
  const names = await imageFilenames([ref.digest], executor);
  return {
    ref,
    model,
    filename: names.get(ref.digest) ?? ref.digest,
    width: row.image.width,
    height: row.image.height,
    detection: row.detection,
    label: row.label,
  };
}
