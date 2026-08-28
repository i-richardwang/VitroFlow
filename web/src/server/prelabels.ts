import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  datasetImages,
  datasets,
  images,
  labels,
  modelVersions,
  prelabels,
} from "../db/schema";
import type { ImageRef } from "../datasets/schema";
import { prelabelSchema, type Prelabel } from "../detection/schema";
import {
  inferenceModelManifest,
  type InferenceModelManifest,
} from "../inference/assignments";
import { sameRuntimeDescriptor } from "../inference/schema";
import type { InferenceWorkerRecord } from "../inference/workers";
import {
  atRef,
  describeRef,
  membershipOrder,
  notInDataset,
  sameMembership,
  toDatasetImage,
  type DatasetImage,
} from "./datasets";
import { canExecute } from "./inference-worker-store";
import { assertDocumentImage } from "./image-documents";
import { toModelVersion } from "./model-registry";
import { lockImageRecord } from "./summaries";

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
    assertDocumentImage("Prelabel", prelabel.image, record.image);
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
      !worker.runtimes.some((runtime) =>
        sameRuntimeDescriptor(runtime, prelabel.producer.runtime),
      )
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

/** One version's share of the pending work, with the manifest to load it. */
export interface Assignment {
  manifest: InferenceModelManifest;
  images: DatasetImage[];
}

/**
 * Unreviewed images whose dataset selects a version the worker can execute
 * and whose prelabel, if any, came from something else; grouped by version.
 */
export async function pendingAssignments(
  worker: Pick<InferenceWorkerRecord, "runtimes">,
): Promise<Assignment[]> {
  const db = await database();
  const rows = await db
    .select({
      membership: datasetImages,
      image: images,
      version: modelVersions,
    })
    .from(datasetImages)
    .innerJoin(images, eq(images.id, datasetImages.imageId))
    .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
    .innerJoin(
      modelVersions,
      and(
        eq(modelVersions.id, datasets.selectedModelVersionId),
        eq(modelVersions.modelId, datasets.modelId),
      ),
    )
    .leftJoin(labels, sameMembership(labels, datasetImages))
    .leftJoin(prelabels, sameMembership(prelabels, datasetImages))
    .where(
      and(
        isNull(labels.imageId),
        or(
          isNull(prelabels.imageId),
          ne(prelabels.modelVersionId, modelVersions.id),
          ne(prelabels.artifactDigest, modelVersions.artifactDigest),
        ),
      ),
    )
    .orderBy(
      asc(modelVersions.id),
      asc(datasetImages.datasetId),
      ...membershipOrder(),
    );
  const assignments: Assignment[] = [];
  for (const row of rows) {
    const last = assignments.at(-1);
    if (last?.manifest.modelVersionId === row.version.id) {
      last.images.push(toDatasetImage(row));
      continue;
    }
    const modelVersion = toModelVersion(row.version);
    if (!canExecute(worker, modelVersion.artifact)) continue;
    assignments.push({
      manifest: inferenceModelManifest(modelVersion),
      images: [toDatasetImage(row)],
    });
  }
  return assignments;
}
