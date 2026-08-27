import { and, eq } from "drizzle-orm";

import {
  annotationSchema,
  type AnnotationDocument,
} from "../annotation/schema";
import { documentFromPrelabel } from "../annotation/prelabel";
import { database, transaction, type Executor } from "../db/client";
import { labels } from "../db/schema";
import type { ImageRef } from "../datasets/schema";
import { isFailure } from "../detection/schema";
import { lockImageRecord } from "./summaries";

function byRef({ dataset, stem }: ImageRef) {
  return and(eq(labels.datasetId, dataset), eq(labels.stem, stem));
}

export async function readLabel(
  ref: ImageRef,
  db?: Executor,
): Promise<AnnotationDocument | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: labels.document })
    .from(labels)
    .where(byRef(ref));
  return row ? annotationSchema.parse(row.document) : null;
}

/** Starts a review; the image row lock freezes the prelabel it starts from. */
export async function createLabel(
  ref: ImageRef,
  document: AnnotationDocument,
): Promise<AnnotationDocument> {
  const created = annotationSchema.parse({ ...document, revision: 0 });
  return transaction(async (tx) => {
    const record = await lockImageRecord(ref, tx);
    if (!record)
      throw new Error(`No image ${ref.stem} in dataset ${ref.dataset}`);
    if (record.label) {
      throw new Error(`Label already exists for ${ref.dataset}/${ref.stem}`);
    }
    await tx.insert(labels).values({
      datasetId: ref.dataset,
      stem: ref.stem,
      document: created,
      updatedAt: new Date(),
    });
    return created;
  });
}

/** Starts a review from the image's prelabel, atomically with reading it. */
export async function createLabelFromPrelabel(
  ref: ImageRef,
): Promise<AnnotationDocument> {
  return transaction(async (tx) => {
    const record = await lockImageRecord(ref, tx);
    if (!record)
      throw new Error(`No image ${ref.stem} in dataset ${ref.dataset}`);
    if (record.label) {
      throw new Error(`Label already exists for ${ref.dataset}/${ref.stem}`);
    }
    if (!record.prelabel || isFailure(record.prelabel)) {
      throw new Error("The image has no detections to start from");
    }
    const created = annotationSchema.parse({
      ...documentFromPrelabel(record.prelabel),
      revision: 0,
    });
    await tx.insert(labels).values({
      datasetId: ref.dataset,
      stem: ref.stem,
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
    throw new Error(`No label exists for ${ref.dataset}/${ref.stem}`);
  }
  const next = annotationSchema.parse({
    ...document,
    image: current.image,
    revision: current.revision + 1,
  });
  const updated = await db
    .update(labels)
    .set({ document: next, updatedAt: new Date() })
    .where(and(byRef(ref), eq(labels.revision, document.revision)))
    .returning({ revision: labels.revision });
  if (updated.length === 0) {
    throw new Error(
      `Label revision ${document.revision} is stale; current revision is ${current.revision}`,
    );
  }
  return next;
}
