import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  compareVersions,
  type ComparedImage,
  type ComparedReading,
  type VersionComparisonDetail,
} from "../../domain/models/comparison";
import type { Tally } from "../../domain/models/classes";
import { inSnapshot, type Executor } from "../infra/db/client";
import {
  datasetImages,
  datasetSnapshotImages,
  datasetSnapshots,
  inferenceOutcomes,
  modelVersions,
  models,
} from "../infra/db/schema";
import { documentTally } from "../readings/public";

function reading(
  status: "succeeded" | "failed" | null,
  counted: Tally,
): ComparedReading {
  if (status === "failed") return "failed";
  return status === "succeeded" ? counted : null;
}

/**
 * The validation images of the model's trained versions that are not
 * current, or of the one version asked for, with what the reviewer and each
 * version counted.
 */
function heldOutImages(
  db: Executor,
  modelId: string,
  versionId: string | undefined,
) {
  const candidateOutcome = alias(inferenceOutcomes, "candidate_outcome");
  const currentOutcome = alias(inferenceOutcomes, "current_outcome");
  return db
    .select({
      versionId: modelVersions.id,
      currentVersionId: models.currentVersionId,
      classes: models.classes,
      digest: datasetSnapshotImages.imageId,
      datasetId: datasetImages.datasetId,
      filename: datasetImages.filename,
      reviewed: documentTally(datasetSnapshotImages.annotation),
      candidateStatus: candidateOutcome.status,
      candidateTally: documentTally(candidateOutcome.document),
      currentStatus: currentOutcome.status,
      currentTally: documentTally(currentOutcome.document),
    })
    .from(modelVersions)
    .innerJoin(models, eq(models.id, modelVersions.modelId))
    .innerJoin(
      datasetSnapshotImages,
      and(
        eq(
          datasetSnapshotImages.snapshotId,
          modelVersions.sourceDatasetSnapshotId,
        ),
        eq(datasetSnapshotImages.split, "val"),
      ),
    )
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, datasetSnapshotImages.snapshotId),
    )
    .leftJoin(
      datasetImages,
      and(
        eq(datasetImages.datasetId, datasetSnapshots.datasetId),
        eq(datasetImages.imageId, datasetSnapshotImages.imageId),
      ),
    )
    .leftJoin(
      candidateOutcome,
      and(
        eq(candidateOutcome.imageId, datasetSnapshotImages.imageId),
        eq(candidateOutcome.modelVersionId, modelVersions.id),
      ),
    )
    .leftJoin(
      currentOutcome,
      and(
        eq(currentOutcome.imageId, datasetSnapshotImages.imageId),
        eq(currentOutcome.modelVersionId, models.currentVersionId),
      ),
    )
    .where(
      and(
        eq(modelVersions.modelId, modelId),
        versionId === undefined ? undefined : eq(modelVersions.id, versionId),
        sql`${models.currentVersionId} is distinct from ${modelVersions.id}`,
      ),
    )
    .orderBy(asc(modelVersions.id), asc(datasetSnapshotImages.imageId));
}

/**
 * Each candidate of the model compared with its current version on the
 * reviewed images the candidate was held out from, or only the version
 * asked for. The current version, and a version that held nothing out,
 * have no comparison.
 */
export function versionComparisons(
  modelId: string,
  { version, executor }: { version?: string; executor?: Executor } = {},
): Promise<Map<string, VersionComparisonDetail>> {
  return inSnapshot(executor, async (db) => {
    const byVersion = new Map<
      string,
      { classes: string[]; current: string | null; images: ComparedImage[] }
    >();
    for (const row of await heldOutImages(db, modelId, version)) {
      const entry = byVersion.get(row.versionId) ?? {
        classes: row.classes,
        current: row.currentVersionId,
        images: [],
      };
      entry.images.push({
        digest: row.digest,
        dataset:
          row.datasetId && row.filename
            ? { id: row.datasetId, filename: row.filename }
            : null,
        reviewed: row.reviewed,
        candidate: reading(row.candidateStatus, row.candidateTally),
        current: reading(row.currentStatus, row.currentTally),
      });
      byVersion.set(row.versionId, entry);
    }
    return new Map(
      [...byVersion].map(([versionId, entry]) => [
        versionId,
        compareVersions(entry.classes, entry.current, entry.images),
      ]),
    );
  });
}

/** One candidate's comparison, image by image, or null when it has none. */
export async function versionComparison(
  modelId: string,
  versionId: string,
): Promise<VersionComparisonDetail | null> {
  return (
    (await versionComparisons(modelId, { version: versionId })).get(
      versionId,
    ) ?? null
  );
}
