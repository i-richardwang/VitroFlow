import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  datasetImages,
  datasets,
  labels,
  modelVersions,
  prelabels,
} from "../db/schema";
import type { ImageRef } from "../datasets/schema";
import { prelabelSchema, type Prelabel } from "../detection/schema";
import { sameRuntimeDescriptor } from "../inference/schema";
import type { InferenceWorkerRecord } from "../inference/workers";
import {
  atRef,
  describeRef,
  membershipOrder,
  notInDataset,
  toDatasetImage,
  type DatasetImage,
} from "./datasets";
import { lockImageRecord, recordQuery } from "./summaries";

/** Thrown when a worker tries to replace the prelabel a review started from. */
export class PrelabelFrozenError extends Error {
  constructor(ref: ImageRef) {
    super(`${describeRef(ref)} is labelled; its prelabel is frozen`);
  }
}

/** Thrown when a prelabel comes from a version other than the one its dataset selects. */
export class ModelVersionMismatchError extends Error {
  constructor(ref: ImageRef) {
    super(`${describeRef(ref)} is assigned to another model version`);
  }
}

export async function readPrelabel(
  ref: ImageRef,
  db?: Executor,
): Promise<Prelabel | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: prelabels.document })
    .from(prelabels)
    .where(atRef(prelabels, ref));
  return row?.document ?? null;
}

export async function writePrelabel(
  ref: ImageRef,
  document: unknown,
  worker: InferenceWorkerRecord,
): Promise<Prelabel> {
  const prelabel = prelabelSchema.parse(document);
  return transaction(async (tx) => {
    const record = await lockImageRecord(ref, tx);
    if (!record) throw notInDataset(ref);
    if (prelabel.image.digest !== ref.digest) {
      throw new Error(
        `Prelabel describes ${prelabel.image.digest}, not ${ref.digest}`,
      );
    }
    if (record.label) {
      throw new PrelabelFrozenError(ref);
    }
    const [assignment] = await tx
      .select({
        modelId: datasets.modelId,
        selectedModelVersionId: datasets.selectedModelVersionId,
        versionModelId: modelVersions.modelId,
        artifactDigest: modelVersions.artifactDigest,
      })
      .from(datasets)
      .innerJoin(
        modelVersions,
        eq(modelVersions.id, prelabel.producer.model_version_id),
      )
      .where(eq(datasets.id, ref.dataset))
      .for("share", { of: datasets });
    if (
      !assignment ||
      assignment.selectedModelVersionId !==
        prelabel.producer.model_version_id ||
      assignment.versionModelId !== assignment.modelId ||
      assignment.artifactDigest !== prelabel.producer.artifact_digest ||
      worker.deployment.modelVersionId !== prelabel.producer.model_version_id ||
      worker.deployment.artifactDigest !== prelabel.producer.artifact_digest ||
      !sameRuntimeDescriptor(worker.runtime, prelabel.producer.runtime)
    ) {
      throw new ModelVersionMismatchError(ref);
    }
    const row = { document: prelabel, createdAt: new Date() };
    await tx
      .insert(prelabels)
      .values({ datasetId: ref.dataset, imageId: ref.digest, ...row })
      .onConflictDoUpdate({
        target: [prelabels.datasetId, prelabels.imageId],
        set: row,
      });
    return prelabel;
  });
}

/** Drops a prelabel so the next worker pass processes the image again. */
export async function discardPrelabel(ref: ImageRef): Promise<void> {
  await transaction(async (tx) => {
    if ((await lockImageRecord(ref, tx))?.label) {
      throw new PrelabelFrozenError(ref);
    }
    await tx.delete(prelabels).where(atRef(prelabels, ref));
  });
}

/**
 * Unreviewed images in datasets that select this exact executable version and
 * whose prelabel, if any, came from something else.
 */
export async function pendingImages(deployment: {
  modelVersionId: string;
  artifactDigest: string;
}): Promise<DatasetImage[]> {
  const db = await database();
  const rows = await recordQuery(db)
    .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
    .innerJoin(
      modelVersions,
      and(
        eq(modelVersions.id, datasets.selectedModelVersionId),
        eq(modelVersions.modelId, datasets.modelId),
      ),
    )
    .where(
      and(
        eq(modelVersions.id, deployment.modelVersionId),
        eq(modelVersions.artifactDigest, deployment.artifactDigest),
        isNull(labels.imageId),
        or(
          isNull(prelabels.imageId),
          ne(prelabels.modelVersionId, deployment.modelVersionId),
          ne(prelabels.artifactDigest, deployment.artifactDigest),
        ),
      ),
    )
    .orderBy(asc(datasetImages.datasetId), ...membershipOrder());
  return rows.map(toDatasetImage);
}
