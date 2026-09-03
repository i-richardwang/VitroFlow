import { and, eq, sql } from "drizzle-orm";

import type { Review } from "../annotation/review";
import type { AnnotationRef } from "../annotation/schema";
import { database, type Executor } from "../db/client";
import { images, inferenceOutcomes, annotations } from "../db/schema";
import type { DetectionResult } from "../detection/schema";
import { imageFilenames } from "./image-names";
import { readModel, readModelVersion } from "./model-registry";
import { newestDetectingVersion } from "./summaries";

/**
 * The review shows the detection of `versionId` when the reviewer arrived
 * from a metric of that version, so the boxes are the ones they just looked
 * at; otherwise the newest of the model's versions that has detected the
 * image. A version of another model names no review.
 */
export async function readReview(
  ref: AnnotationRef,
  versionId?: string,
  db?: Executor,
): Promise<Review | null> {
  const executor = db ?? (await database());
  const model = await readModel(ref.modelId, executor);
  if (!model) return null;
  if (versionId !== undefined) {
    const version = await readModelVersion(versionId, executor);
    if (version?.modelId !== ref.modelId) return null;
  }
  const shown =
    versionId === undefined
      ? newestDetectingVersion(images.id, ref.modelId)
      : versionId;
  const [row] = await executor
    .select({
      image: images,
      detection: sql<DetectionResult | null>`${inferenceOutcomes.document}`,
      annotation: annotations.document,
    })
    .from(images)
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, images.id),
        eq(annotations.modelId, ref.modelId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, images.id),
        eq(inferenceOutcomes.modelVersionId, shown),
        eq(inferenceOutcomes.status, "succeeded"),
      ),
    )
    .where(eq(images.id, ref.digest));
  if (!row) return null;
  const names = await imageFilenames([ref.digest], executor);
  const common: Omit<Review, "state" | "detection" | "annotation"> = {
    ref,
    model,
    filename: names.get(ref.digest) ?? ref.digest,
    width: row.image.width,
    height: row.image.height,
  };
  if (row.annotation) {
    return {
      ...common,
      state: "started",
      detection: row.detection,
      annotation: row.annotation,
    };
  }
  return row.detection
    ? {
        ...common,
        state: "detected",
        detection: row.detection,
        annotation: null,
      }
    : { ...common, state: "waiting", detection: null, annotation: null };
}
