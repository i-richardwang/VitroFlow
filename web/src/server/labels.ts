import { and, eq } from "drizzle-orm";

import {
  annotationSchema,
  type AnnotationDocument,
  type LabelRef,
} from "../annotation/schema";
import { documentFromDetection } from "../annotation/detection";
import { database, transaction, type Executor } from "../db/client";
import { images, labels } from "../db/schema";
import { assertInstanceClasses } from "../models/readings";
import { readDetection } from "./inference-outcomes";
import { assertDocumentImage } from "./image-documents";
import { lockImage } from "./image-lock";
import { readModel, readModelVersion } from "./model-registry";

export function atLabel({ digest, model }: LabelRef) {
  return and(eq(labels.imageId, digest), eq(labels.modelId, model));
}

export function describeLabel({ digest, model }: LabelRef): string {
  return `${digest} for ${model}`;
}

export async function readLabel(
  ref: LabelRef,
  db?: Executor,
): Promise<AnnotationDocument | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: labels.document })
    .from(labels)
    .where(atLabel(ref));
  return row?.document ?? null;
}

async function lockedImage(digest: string, tx: Executor) {
  await lockImage(digest, tx);
  const [image] = await tx
    .select({ digest: images.id, width: images.width, height: images.height })
    .from(images)
    .where(eq(images.id, digest));
  if (!image) throw new Error(`Image ${digest} is not stored`);
  return image;
}

async function insertLabel(
  ref: LabelRef,
  document: AnnotationDocument,
  tx: Executor,
): Promise<AnnotationDocument> {
  const created = annotationSchema.parse({ ...document, revision: 0 });
  const image = await lockedImage(ref.digest, tx);
  assertDocumentImage("Label", created.image, image);
  const version = await readModelVersion(created.source.modelVersionId, tx);
  if (!version || version.modelId !== ref.model) {
    throw new Error(
      `Version ${created.source.modelVersionId} is not a version of ${ref.model}`,
    );
  }
  const model = await readModel(ref.model, tx);
  if (!model) throw new Error(`Unknown model: ${ref.model}`);
  assertInstanceClasses(model.classes, created.instances, "Label");
  if (await readLabel(ref, tx)) {
    throw new Error(`Label already exists for ${describeLabel(ref)}`);
  }
  await tx.insert(labels).values({
    imageId: ref.digest,
    modelId: ref.model,
    document: created,
    updatedAt: new Date(),
  });
  return created;
}

/**
 * Starts a review from what one version of the model found, atomically with
 * reading it. The version is the one whose result the reviewer is looking at.
 */
export async function createLabelFromDetection(
  ref: LabelRef,
  versionId: string,
): Promise<AnnotationDocument> {
  return transaction(async (tx) => {
    const detection = await readDetection(
      { versionId, digest: ref.digest },
      tx,
    );
    if (!detection) {
      throw new Error(`${versionId} has not detected ${ref.digest}`);
    }
    return insertLabel(ref, documentFromDetection(detection), tx);
  });
}

/** Replaces the label only when the caller edited its current revision. */
export async function updateLabel(
  ref: LabelRef,
  document: AnnotationDocument,
): Promise<AnnotationDocument> {
  const db = await database();
  const current = await readLabel(ref, db);
  if (!current) {
    throw new Error(`No label exists for ${describeLabel(ref)}`);
  }
  const next = annotationSchema.parse({
    ...document,
    image: current.image,
    source: current.source,
    revision: current.revision + 1,
  });
  const model = await readModel(ref.model, db);
  if (!model) throw new Error(`Unknown model: ${ref.model}`);
  assertInstanceClasses(model.classes, next.instances, "Label");
  const updated = await db
    .update(labels)
    .set({ document: next, updatedAt: new Date() })
    .where(and(atLabel(ref), eq(labels.revision, document.revision)))
    .returning({ revision: labels.revision });
  if (updated.length === 0) {
    throw new Error(
      `Label revision ${document.revision} is stale; current revision is ${current.revision}`,
    );
  }
  return next;
}
