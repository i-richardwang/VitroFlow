import * as fs from "node:fs";

import {
  annotationSchema,
  type AnnotationDocument,
} from "../annotation/schema";
import { writeAtomically } from "./files";
import { LABELS_DIR, resolveWithin } from "./paths";

function labelPath(key: string): string {
  return resolveWithin(LABELS_DIR, `${key}.json`);
}

export function readLabel(key: string): AnnotationDocument | null {
  const filePath = labelPath(key);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return annotationSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
}

function persist(key: string, document: AnnotationDocument): void {
  const filePath = labelPath(key);
  writeAtomically(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

export function createLabel(
  key: string,
  document: AnnotationDocument,
): AnnotationDocument {
  if (fs.existsSync(labelPath(key))) {
    throw new Error(`Label already exists for ${key}`);
  }
  const created = annotationSchema.parse({ ...document, revision: 0 });
  persist(key, created);
  return created;
}

export function updateLabel(
  key: string,
  document: AnnotationDocument,
): AnnotationDocument {
  const current = readLabel(key);
  if (!current) {
    throw new Error(`No label exists for ${key}`);
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
  persist(key, next);
  return next;
}
