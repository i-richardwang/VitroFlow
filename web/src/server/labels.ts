import { and, eq } from "drizzle-orm";

import {
  annotationSchema,
  type AnnotationDocument,
} from "../annotation/schema";
import { documentFromDetection } from "../annotation/detection";
import { database, transaction, type Executor } from "../db/client";
import { labels } from "../db/schema";
import type { ImageRef } from "../datasets/schema";
import { atRef, describeRef, notInDataset } from "./datasets";
import { assertDocumentImage } from "./image-documents";
import { lockImageRecord } from "./summaries";

export async function readLabel(
  ref: ImageRef,
  db?: Executor,
): Promise<AnnotationDocument | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: labels.document })
    .from(labels)
    .where(atRef(labels, ref));
  return row?.document ?? null;
}

/** Starts a review from a document the caller assembled. */
export async function createLabel(
  ref: ImageRef,
  document: AnnotationDocument,
): Promise<AnnotationDocument> {
  const created = annotationSchema.parse({ ...document, revision: 0 });
  return transaction(async (tx) => {
    const record = await lockImageRecord(ref, tx);
    if (!record) throw notInDataset(ref);
    assertDocumentImage("Label", created.image, record.image);
    if (record.label) {
      throw new Error(`Label already exists for ${describeRef(ref)}`);
    }
    await tx.insert(labels).values({
      datasetId: ref.dataset,
      imageId: ref.digest,
      document: created,
      updatedAt: new Date(),
    });
    return created;
  });
}

/** Starts a review from the selected version's detection, atomically with reading it. */
export async function createLabelFromDetection(
  ref: ImageRef,
): Promise<AnnotationDocument> {
  return transaction(async (tx) => {
    const record = await lockImageRecord(ref, tx);
    if (!record) throw notInDataset(ref);
    if (record.label) {
      throw new Error(`Label already exists for ${describeRef(ref)}`);
    }
    if (!record.detection) {
      throw new Error("The image has no detections to start from");
    }
    const created = annotationSchema.parse({
      ...documentFromDetection(record.detection),
      revision: 0,
    });
    await tx.insert(labels).values({
      datasetId: ref.dataset,
      imageId: ref.digest,
      document: created,
      updatedAt: new Date(),
    });
    return created;
  });
}

/** Replaces the label only when the caller edited its current revision. */
export async function updateLabel(
  ref: ImageRef,
  document: AnnotationDocument,
): Promise<AnnotationDocument> {
  const db = await database();
  const current = await readLabel(ref, db);
  if (!current) {
    throw new Error(`No label exists for ${describeRef(ref)}`);
  }
  const next = annotationSchema.parse({
    ...document,
    image: current.image,
    source: current.source,
    revision: current.revision + 1,
  });
  const updated = await db
    .update(labels)
    .set({ document: next, updatedAt: new Date() })
    .where(and(atRef(labels, ref), eq(labels.revision, document.revision)))
    .returning({ revision: labels.revision });
  if (updated.length === 0) {
    throw new Error(
      `Label revision ${document.revision} is stale; current revision is ${current.revision}`,
    );
  }
  return next;
}
