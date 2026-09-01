import { and, eq } from "drizzle-orm";

import {
  annotationSchema,
  type AnnotationDocument,
  type AnnotationRef,
} from "../annotation/schema";
import { documentFromDetection } from "../annotation/detection";
import { database, transaction, type Executor } from "../db/client";
import { images, annotations } from "../db/schema";
import { assertInstanceClasses } from "../models/metrics";
import { readDetection } from "./inference-outcomes";
import { assertDocumentImage } from "./image-documents";
import { lockImage } from "./image-lock";
import { readModel, readModelVersion } from "./model-registry";

export function atAnnotation({ digest, modelId }: AnnotationRef) {
  return and(eq(annotations.imageId, digest), eq(annotations.modelId, modelId));
}

export function describeAnnotation({ digest, modelId }: AnnotationRef): string {
  return `${digest} for ${modelId}`;
}

export async function readAnnotation(
  ref: AnnotationRef,
  db?: Executor,
): Promise<AnnotationDocument | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: annotations.document })
    .from(annotations)
    .where(atAnnotation(ref));
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

async function insertAnnotation(
  ref: AnnotationRef,
  document: AnnotationDocument,
  tx: Executor,
): Promise<AnnotationDocument> {
  const created = annotationSchema.parse({ ...document, revision: 0 });
  const image = await lockedImage(ref.digest, tx);
  assertDocumentImage("Annotation", created.image, image);
  const version = await readModelVersion(created.source.modelVersionId, tx);
  if (!version || version.modelId !== ref.modelId) {
    throw new Error(
      `Version ${created.source.modelVersionId} is not a version of ${ref.modelId}`,
    );
  }
  const model = await readModel(ref.modelId, tx);
  if (!model) throw new Error(`Unknown model: ${ref.modelId}`);
  assertInstanceClasses(model.classes, created.instances, "Annotation");
  if (await readAnnotation(ref, tx)) {
    throw new Error(`Annotation already exists for ${describeAnnotation(ref)}`);
  }
  await tx.insert(annotations).values({
    imageId: ref.digest,
    modelId: ref.modelId,
    document: created,
    updatedAt: new Date(),
  });
  return created;
}

/**
 * Starts a review from what one version of the model found. The source version
 * is the one whose result the reviewer is looking at.
 */
export async function createAnnotationFromDetection(
  ref: AnnotationRef,
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
    return insertAnnotation(ref, documentFromDetection(detection), tx);
  });
}

/** Replaces the annotation only when the caller edited its current revision. */
export async function updateAnnotation(
  ref: AnnotationRef,
  document: AnnotationDocument,
): Promise<AnnotationDocument> {
  const db = await database();
  const current = await readAnnotation(ref, db);
  if (!current) {
    throw new Error(`No annotation exists for ${describeAnnotation(ref)}`);
  }
  const next = annotationSchema.parse({
    ...document,
    image: current.image,
    source: current.source,
    revision: current.revision + 1,
  });
  const model = await readModel(ref.modelId, db);
  if (!model) throw new Error(`Unknown model: ${ref.modelId}`);
  assertInstanceClasses(model.classes, next.instances, "Annotation");
  const updated = await db
    .update(annotations)
    .set({ document: next, updatedAt: new Date() })
    .where(and(atAnnotation(ref), eq(annotations.revision, document.revision)))
    .returning({ revision: annotations.revision });
  if (updated.length === 0) {
    throw new Error(
      `Annotation revision ${document.revision} is stale; current revision is ${current.revision}`,
    );
  }
  return next;
}
