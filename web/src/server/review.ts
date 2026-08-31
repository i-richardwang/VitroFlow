import { and, eq, sql } from "drizzle-orm";

import type { Review } from "../annotation/review";
import type { LabelRef } from "../annotation/schema";
import { database, type Executor } from "../db/client";
import { images, inferenceOutcomes, labels } from "../db/schema";
import type { DetectionResult } from "../detection/schema";
import { imageFilenames } from "./image-names";
import { readModel, readModelVersion } from "./model-registry";
import { shownVersion } from "./summaries";

/**
 * Everything the review workbench needs for one image and one model: the
 * review if it has started, and otherwise the detection it would start from.
 */
/**
 * A review that has started shows the detection it started from. Before
 * that, it shows the detection of `versionId` when the reviewer arrived from
 * a reading of that version, so the boxes are the ones they just looked at;
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
      detection: sql<DetectionResult | null>`${inferenceOutcomes.document}`,
      label: labels.document,
    })
    .from(images)
    .leftJoin(
      labels,
      and(eq(labels.imageId, images.id), eq(labels.modelId, ref.model)),
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
  const common: Omit<Review, "state" | "detection" | "label"> = {
    ref,
    model,
    filename: names.get(ref.digest) ?? ref.digest,
    width: row.image.width,
    height: row.image.height,
  };
  if (row.label) {
    const detection = row.detection;
    if (!detection) {
      throw new Error(
        `Review ${ref.digest} for ${ref.model} has no source detection`,
      );
    }
    return {
      ...common,
      state: "started",
      detection,
      label: row.label,
    };
  }
  return row.detection
    ? { ...common, state: "detected", detection: row.detection, label: null }
    : { ...common, state: "waiting", detection: null, label: null };
}
