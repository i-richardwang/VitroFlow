import { and, eq } from "drizzle-orm";

import {
  annotationSchema,
  type AnnotationDocument,
  type AnnotationInstance,
  type AnnotationRef,
} from "../annotation/schema";
import { database, transaction } from "../db/client";
import { annotations, images } from "../db/schema";
import { assertInstanceClasses } from "../models/metrics";
import { lockImage } from "./image-lock";
import { readModel } from "./model-registry";

function atAnnotation({ digest, modelId }: AnnotationRef) {
  return and(eq(annotations.imageId, digest), eq(annotations.modelId, modelId));
}

export async function readAnnotation(
  ref: AnnotationRef,
): Promise<AnnotationDocument | null> {
  const [row] = await (
    await database()
  )
    .select({ document: annotations.document })
    .from(annotations)
    .where(atAnnotation(ref));
  return row?.document ?? null;
}

/**
 * Stores the boxes a reviewer decided on as the image's review for the model.
 * The document is composed here, on the stored image, so a review can only
 * ever describe the image it is addressed to; a later review replaces it.
 */
export async function storeAnnotation(
  ref: AnnotationRef,
  instances: AnnotationInstance[],
): Promise<AnnotationDocument> {
  return transaction(async (tx) => {
    await lockImage(ref.digest, tx);
    const [image] = await tx
      .select({ width: images.width, height: images.height })
      .from(images)
      .where(eq(images.id, ref.digest));
    if (!image) throw new Error(`Image ${ref.digest} is not stored`);
    const model = await readModel(ref.modelId, tx);
    if (!model) throw new Error(`Unknown model: ${ref.modelId}`);
    const document = annotationSchema.parse({
      schemaVersion: 1,
      image: { digest: ref.digest, ...image },
      instances,
    });
    assertInstanceClasses(model.classes, document.instances, "Annotation");
    const updatedAt = new Date();
    await tx
      .insert(annotations)
      .values({
        imageId: ref.digest,
        modelId: ref.modelId,
        document,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [annotations.imageId, annotations.modelId],
        set: { document, updatedAt },
      });
    return document;
  });
}
