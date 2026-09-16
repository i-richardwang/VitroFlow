import { and, eq, sql } from "drizzle-orm";

import type { Review } from "../../domain/annotation/review";
import type { AnnotationRef } from "../../domain/annotation/schema";
import type { Executor } from "../infra/db/client";
import { images, inferenceOutcomes, annotations } from "../infra/db/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { newestDetectingVersion } from "../inference/public";
import {
  latestRunId,
  latestRuns,
  proposalRunId,
  proposalRuns,
  toActivity,
  toProposal,
} from "../annotation-runs/public";

/**
 * The review joins each reading on its own: the newest of the model's
 * versions that has detected the image, the newest agent run that succeeded,
 * and the stored annotation. Images carry no name of their own, so the page
 * names the file as it knows it.
 */
export async function readReview(
  ref: AnnotationRef,
  filename: string,
  db: Executor,
): Promise<Review | null> {
  const shown = newestDetectingVersion(images.id, ref.modelId);
  const [row] = await db
    .select({
      width: images.width,
      height: images.height,
      detection: sql<DetectionResult | null>`${inferenceOutcomes.document}`,
      annotation: annotations.document,
      proposal: proposalRuns,
      latest: latestRuns,
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
    .leftJoin(
      proposalRuns,
      eq(proposalRuns.id, proposalRunId(images.id, ref.modelId)),
    )
    .leftJoin(
      latestRuns,
      eq(latestRuns.id, latestRunId(images.id, ref.modelId)),
    )
    .where(eq(images.id, ref.digest));
  if (!row) return null;
  return {
    ref,
    filename,
    width: row.width,
    height: row.height,
    detection: row.detection,
    proposal: toProposal(row.proposal),
    annotation: row.annotation,
    activity: toActivity(row.latest),
  };
}
