import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { z } from "zod";

import {
  annotationSchema,
  type AnnotationDocument,
} from "../annotation/schema";
import type { ImageRef } from "../datasets/schema";
import { writeAtomically } from "./files";
import { LABELS_DIR, resolveWithin } from "./paths";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const legacyAnnotationSchema = z
  .object({
    source: z.strictObject({
      pipelineFingerprint: fingerprint,
      modelFingerprint: fingerprint,
    }),
  })
  .passthrough();

function labelPath({ dataset, stem }: ImageRef): string {
  return resolveWithin(LABELS_DIR, dataset, `${stem}.json`);
}

export function hasLabel(ref: ImageRef): boolean {
  return fs.existsSync(labelPath(ref));
}

export function readLabel(ref: ImageRef): AnnotationDocument | null {
  const filePath = labelPath(ref);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const document: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const current = annotationSchema.safeParse(document);
  if (current.success) {
    return current.data;
  }
  const legacy = legacyAnnotationSchema.parse(document);
  const prelabelerFingerprint = createHash("sha256")
    .update(legacy.source.pipelineFingerprint)
    .update("\0")
    .update(legacy.source.modelFingerprint)
    .digest("hex");
  return annotationSchema.parse({
    ...legacy,
    source: {
      prelabelerVersionId: `traditional-legacy-${prelabelerFingerprint.slice(0, 12)}`,
      prelabelerFingerprint,
    },
  });
}

function persist(ref: ImageRef, document: AnnotationDocument): void {
  writeAtomically(labelPath(ref), `${JSON.stringify(document, null, 2)}\n`);
}

export function createLabel(
  ref: ImageRef,
  document: AnnotationDocument,
): AnnotationDocument {
  if (hasLabel(ref)) {
    throw new Error(`Label already exists for ${ref.dataset}/${ref.stem}`);
  }
  const created = annotationSchema.parse({ ...document, revision: 0 });
  persist(ref, created);
  return created;
}

export function updateLabel(
  ref: ImageRef,
  document: AnnotationDocument,
): AnnotationDocument {
  const current = readLabel(ref);
  if (!current) {
    throw new Error(`No label exists for ${ref.dataset}/${ref.stem}`);
  }
  if (document.revision !== current.revision) {
    throw new Error(
      `Label revision ${document.revision} is stale; current revision is ${current.revision}`,
    );
  }
  const next = annotationSchema.parse({
    ...document,
    image: current.image,
    revision: current.revision + 1,
  });
  persist(ref, next);
  return next;
}
