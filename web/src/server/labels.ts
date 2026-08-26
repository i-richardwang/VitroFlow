import * as fs from "node:fs";

import {
  annotationSchema,
  type AnnotationDocument,
} from "../annotation/schema";
import type { ImageRef } from "../datasets/schema";
import { writeAtomically } from "./files";
import { LABELS_DIR, resolveWithin } from "./paths";

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
  return annotationSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
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
