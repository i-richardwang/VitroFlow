import { and, eq } from "drizzle-orm";

import {
  annotationSchema,
  type AnnotationDocument,
  type AnnotationRef,
} from "../annotation/schema";
import { database, transaction, type Executor } from "../db/client";
import { annotations, images } from "../db/schema";
import { assertInstanceClasses } from "../models/metrics";
import { assertDocumentImage } from "./image-documents";
import { lockImage } from "./image-lock";
import { readModel } from "./model-registry";

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

/** Checks the document against the image and the model, then stores it. */
async function writeAnnotation(
  ref: AnnotationRef,
  document: AnnotationDocument,
  tx: Executor,
): Promise<AnnotationDocument> {
  const next = annotationSchema.parse(document);
  const [image] = await tx
    .select({ digest: images.id, width: images.width, height: images.height })
    .from(images)
    .where(eq(images.id, ref.digest));
  if (!image) throw new Error(`Image ${ref.digest} is not stored`);
  assertDocumentImage("Annotation", next.image, image);
  const model = await readModel(ref.modelId, tx);
  if (!model) throw new Error(`Unknown model: ${ref.modelId}`);
  assertInstanceClasses(model.classes, next.instances, "Annotation");
  await tx
    .insert(annotations)
    .values({
      imageId: ref.digest,
      modelId: ref.modelId,
      document: next,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [annotations.imageId, annotations.modelId],
      set: { document: next, updatedAt: new Date() },
    });
  return next;
}

/**
 * Saves the review, creating it on the reviewer's first edit. The editor opens
 * on a copy of the detection at revision 0, which no stored review carries, so
 * one rule covers both: the document must arrive at the revision it was edited
 * from, and an edit of boxes that have since been replaced is refused as stale.
 */
export async function saveAnnotation(
  ref: AnnotationRef,
  document: AnnotationDocument,
): Promise<AnnotationDocument> {
  return transaction(async (tx) => {
    await lockImage(ref.digest, tx);
    const edited = (await readAnnotation(ref, tx))?.revision ?? 0;
    if (document.revision !== edited) {
      throw new Error(
        `Annotation ${describeAnnotation(ref)} is at revision ${edited}; ` +
          `revision ${document.revision} is stale`,
      );
    }
    return writeAnnotation(ref, { ...document, revision: edited + 1 }, tx);
  });
}
