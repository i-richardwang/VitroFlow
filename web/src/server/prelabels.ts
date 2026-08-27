import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  datasets,
  images,
  labels,
  modelVersions,
  prelabels,
} from "../db/schema";
import type { ImageRef } from "../datasets/schema";
import { prelabelSchema, type Prelabel } from "../detection/schema";
import { sameRuntimeDescriptor } from "../inference/schema";
import type { InferenceWorkerRecord } from "../inference/workers";
import { toDatasetImage, type DatasetImage } from "./datasets";
import { lockImageRecord } from "./summaries";

/** Thrown when a worker tries to replace the prelabel a review started from. */
export class PrelabelFrozenError extends Error {
  constructor(ref: ImageRef) {
    super(`${ref.dataset}/${ref.stem} is labelled; its prelabel is frozen`);
  }
}

/** Thrown when a prelabel comes from a version other than the one its dataset selects. */
export class ModelVersionMismatchError extends Error {
  constructor(ref: ImageRef) {
    super(`${ref.dataset}/${ref.stem} is assigned to another model version`);
  }
}

function byRef({ dataset, stem }: ImageRef) {
  return and(eq(prelabels.datasetId, dataset), eq(prelabels.stem, stem));
}

export async function readPrelabel(
  ref: ImageRef,
  db?: Executor,
): Promise<Prelabel | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: prelabels.document })
    .from(prelabels)
    .where(byRef(ref));
  return row ? prelabelSchema.parse(row.document) : null;
}

export async function writePrelabel(
  ref: ImageRef,
  document: unknown,
  worker: InferenceWorkerRecord,
): Promise<Prelabel> {
  const prelabel = prelabelSchema.parse(document);
  return transaction(async (tx) => {
    const record = await lockImageRecord(ref, tx);
    if (!record) {
      throw new Error(`No image ${ref.stem} in dataset ${ref.dataset}`);
    }
    if (prelabel.source !== record.image.source) {
      throw new Error(
        `Prelabel source ${prelabel.source} does not match ${record.image.source}`,
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
      .values({ datasetId: ref.dataset, stem: ref.stem, ...row })
      .onConflictDoUpdate({
        target: [prelabels.datasetId, prelabels.stem],
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
    await tx.delete(prelabels).where(byRef(ref));
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
  const rows = await db
    .select({ image: images })
    .from(images)
    .innerJoin(datasets, eq(datasets.id, images.datasetId))
    .innerJoin(
      modelVersions,
      and(
        eq(modelVersions.id, datasets.selectedModelVersionId),
        eq(modelVersions.modelId, datasets.modelId),
      ),
    )
    .leftJoin(
      labels,
      and(eq(labels.datasetId, images.datasetId), eq(labels.stem, images.stem)),
    )
    .leftJoin(
      prelabels,
      and(
        eq(prelabels.datasetId, images.datasetId),
        eq(prelabels.stem, images.stem),
      ),
    )
    .where(
      and(
        eq(modelVersions.id, deployment.modelVersionId),
        eq(modelVersions.artifactDigest, deployment.artifactDigest),
        isNull(labels.stem),
        or(
          isNull(prelabels.stem),
          ne(prelabels.modelVersionId, deployment.modelVersionId),
          ne(prelabels.artifactDigest, deployment.artifactDigest),
        ),
      ),
    )
    .orderBy(asc(images.datasetId), asc(images.stem));
  return rows.map((row) => toDatasetImage(row.image));
}
