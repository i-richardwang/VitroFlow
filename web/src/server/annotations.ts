import { and, eq } from "drizzle-orm";

import {
  annotationSchema,
  type AnnotationDocument,
  type AnnotationRef,
} from "../annotation/schema";
import { documentFromDetection } from "../annotation/detection";
import { database, transaction, type Executor } from "../db/client";
import { annotations, images } from "../db/schema";
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

/** The model of the review, with the classes its boxes may carry. */
async function reviewedModel(ref: AnnotationRef, db: Executor) {
  const model = await readModel(ref.modelId, db);
  if (!model) throw new Error(`Unknown model: ${ref.modelId}`);
  return model;
}

/**
 * Starts the review of the image for the model from what `versionId` found.
 * A review that already exists starts again: the detection's boxes replace
 * the reviewer's and the review reopens, one revision later so that an edit
 * of the previous boxes still in flight is refused as stale.
 */
export async function startAnnotationFromDetection(
  ref: AnnotationRef,
  versionId: string,
): Promise<AnnotationDocument> {
  return transaction(async (tx) => {
    const version = await readModelVersion(versionId, tx);
    if (!version || version.modelId !== ref.modelId) {
      throw new Error(
        `Version ${versionId} is not a version of ${ref.modelId}`,
      );
    }
    const detection = await readDetection(
      { versionId, digest: ref.digest },
      tx,
    );
    if (!detection) {
      throw new Error(`${versionId} has not detected ${ref.digest}`);
    }
    await lockImage(ref.digest, tx);
    const [image] = await tx
      .select({ digest: images.id, width: images.width, height: images.height })
      .from(images)
      .where(eq(images.id, ref.digest));
    if (!image) throw new Error(`Image ${ref.digest} is not stored`);
    const model = await reviewedModel(ref, tx);
    const current = await readAnnotation(ref, tx);
    const started = annotationSchema.parse({
      ...documentFromDetection(detection),
      revision: current ? current.revision + 1 : 0,
    });
    assertDocumentImage("Annotation", started.image, image);
    assertInstanceClasses(model.classes, started.instances, "Annotation");
    await tx
      .insert(annotations)
      .values({
        imageId: ref.digest,
        modelId: ref.modelId,
        document: started,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [annotations.imageId, annotations.modelId],
        set: { document: started, updatedAt: new Date() },
      });
    return started;
  });
}

/** Replaces the annotation only when the caller edited its current revision. */
export async function updateAnnotation(
  ref: AnnotationRef,
  document: AnnotationDocument,
): Promise<AnnotationDocument> {
  return transaction(async (tx) => {
    await lockImage(ref.digest, tx);
    const current = await readAnnotation(ref, tx);
    if (!current) {
      throw new Error(`No annotation exists for ${describeAnnotation(ref)}`);
    }
    if (document.revision !== current.revision) {
      throw new Error(
        `Annotation revision ${document.revision} is stale; current revision is ${current.revision}`,
      );
    }
    const next = annotationSchema.parse({
      ...document,
      image: current.image,
      revision: current.revision + 1,
    });
    const model = await reviewedModel(ref, tx);
    assertInstanceClasses(model.classes, next.instances, "Annotation");
    await tx
      .update(annotations)
      .set({ document: next, updatedAt: new Date() })
      .where(atAnnotation(ref));
    return next;
  });
}
