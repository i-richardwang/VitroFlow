import { and, eq, sql } from "drizzle-orm";

import type { Review } from "../annotation/review";
import type { AnnotationRef } from "../annotation/schema";
import { database, type Executor } from "../db/client";
import { images, inferenceOutcomes, annotations } from "../db/schema";
import type { DetectionResult } from "../detection/schema";
import { readModelVersion } from "./model-registry";
import { newestDetectingVersion } from "./summaries";

/**
 * The review shows the detection of `versionId` when the page is about that
 * version, so the boxes are the ones its metrics were read from; otherwise
 * the newest of the model's versions that has detected the image. A version
 * of another model names no review. Images carry no name of their own, so
 * the page names the file as it knows it.
 */
export async function readReview(
  ref: AnnotationRef,
  filename: string,
  versionId?: string,
  db?: Executor,
): Promise<Review | null> {
  const executor = db ?? (await database());
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
      width: images.width,
      height: images.height,
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
  return {
    ref,
    filename,
    width: row.width,
    height: row.height,
    detection: row.detection,
    annotation: row.annotation,
  };
}
