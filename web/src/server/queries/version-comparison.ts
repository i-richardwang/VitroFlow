import { and, asc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  compareVersions,
  type ComparedImage,
  type ComparedReading,
  type VersionComparison,
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

function tallyOf(document: SQL | AnyColumn) {
  return sql<Tally>`(select coalesce(jsonb_object_agg(instance.class, instance.total), '{}'::jsonb) from (select item->>'class' as class, count(*) as total from jsonb_array_elements(${document}->'instances') as item group by 1) as instance)`;
}

function reading(
  status: "succeeded" | "failed" | null,
  counted: Tally | null,
): ComparedReading {
  if (status === "failed") return "failed";
  return status === "succeeded" ? (counted ?? {}) : null;
}

/** The validation images of every trained version of the model that is not current. */
async function heldOutImages(modelId: string, db: Executor) {
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
      reviewed: tallyOf(datasetSnapshotImages.annotation),
      candidateStatus: candidateOutcome.status,
      candidateTally: sql<Tally | null>`case when ${candidateOutcome.status} = 'succeeded' then ${tallyOf(candidateOutcome.document)} end`,
      currentStatus: currentOutcome.status,
      currentTally: sql<Tally | null>`case when ${currentOutcome.status} = 'succeeded' then ${tallyOf(currentOutcome.document)} end`,
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
        sql`${models.currentVersionId} is distinct from ${modelVersions.id}`,
      ),
    )
    .orderBy(asc(modelVersions.id), asc(datasetSnapshotImages.imageId));
}

export interface VersionComparisonDetail extends VersionComparison {
  images: ComparedImage[];
}

/**
 * Every candidate of the model compared with its current version on the
 * reviewed images the candidate was held out from. The current version, and
 * a version that trained on nothing held out, have no comparison.
 */
export async function versionComparisons(
  modelId: string,
  executor?: Executor,
): Promise<Map<string, VersionComparisonDetail>> {
  return inSnapshot(executor, async (db) => {
    const rows = await heldOutImages(modelId, db);
    const byVersion = new Map<
      string,
      { classes: string[]; current: string | null; images: ComparedImage[] }
    >();
    for (const row of rows) {
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
        current:
          row.currentVersionId === null
            ? null
            : reading(row.currentStatus, row.currentTally),
      });
      byVersion.set(row.versionId, entry);
    }
    return new Map(
      [...byVersion].map(([versionId, entry]) => [
        versionId,
        {
          ...compareVersions(entry.classes, entry.current, entry.images),
          images: entry.images,
        },
      ]),
    );
  });
}

/** One candidate's comparison, image by image, or null when it has none. */
export async function versionComparison(
  modelId: string,
  versionId: string,
): Promise<VersionComparisonDetail | null> {
  return (await versionComparisons(modelId)).get(versionId) ?? null;
}
