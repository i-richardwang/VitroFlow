import * as fs from "node:fs";
import * as path from "node:path";

import {
  annotationSchema,
  type AnnotationDocument,
} from "../annotation/schema";
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

/** Writes the whole document to a sibling file, then renames it into place. */
function persist(key: string, document: AnnotationDocument): void {
  const filePath = labelPath(key);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

/** Creates the label for an image that has none. */
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

/**
 * Replaces the label for an image. The caller's document must carry the
 * revision it was based on; a stale revision is rejected so concurrent
 * saves cannot overwrite each other.
 */
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
