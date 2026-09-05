import { and, eq, sql } from "drizzle-orm";

import type { Review } from "../annotation/review";
import type { AnnotationRef } from "../annotation/schema";
import { database, type Executor } from "../db/client";
import { images, inferenceOutcomes, annotations } from "../db/schema";
import type { DetectionResult } from "../detection/schema";
import { newestDetectingVersion } from "./summaries";

/**
 * The review shows the newest of the model's versions that has detected the
 * image. Images carry no name of their own, so the page names the file as it
 * knows it.
 */
export async function readReview(
  ref: AnnotationRef,
  filename: string,
  db?: Executor,
): Promise<Review | null> {
  const executor = db ?? (await database());
  const shown = newestDetectingVersion(images.id, ref.modelId);
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
