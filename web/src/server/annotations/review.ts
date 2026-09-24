import { and, eq, sql } from "drizzle-orm";

import {
  annotationReading,
  type Readings,
  type Review,
} from "../../domain/annotation/review";
import { AnnotationRunNotFoundError } from "../../domain/annotation-runs/errors";
import type { AnnotationRef } from "../../domain/annotation/schema";
import { database, type Executor } from "../infra/db/client";
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
 * Images carry no name of their own, so the page names the file as it knows
 * it; the readings are the same wherever the image is shown.
 */
export async function readReview(
  ref: AnnotationRef,
  filename: string,
  db: Executor,
): Promise<Review | null> {
  const readings = await readReadings(ref, db);
  return readings && { ...readings, filename };
}

/** The readings as an agent consults them before redrawing part of the image. */
export async function readAnnotationReading(ref: AnnotationRef) {
  const readings = await readReadings(ref, await database());
  if (!readings) throw new AnnotationRunNotFoundError("Image not found");
  return annotationReading(readings);
}

/**
 * The review joins each reading on its own: the newest of the model's
 * versions that has detected the image, the newest agent run that succeeded,
 * and the stored annotation.
 */
export async function readReadings(
  ref: AnnotationRef,
  db: Executor,
): Promise<Readings | null> {
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
    width: row.width,
    height: row.height,
    detection: row.detection,
    proposal: toProposal(row.proposal),
    annotation: row.annotation,
    activity: toActivity(row.latest),
  };
}
