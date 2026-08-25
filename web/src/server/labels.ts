import * as fs from "node:fs";
import * as path from "node:path";

import {
  annotationSchema,
  type AnnotationDocument,
} from "../annotation/schema";
import { REPO_ROOT, safeJoin } from "./paths";

const LABELS_DIR = path.join(REPO_ROOT, "data", "labels");

function labelPath(stem: string): string {
  return safeJoin(LABELS_DIR, `${stem}.json`);
}

export function readLabel(stem: string): AnnotationDocument | null {
  const filePath = labelPath(stem);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return annotationSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
}

function persist(stem: string, document: AnnotationDocument): void {
  fs.mkdirSync(LABELS_DIR, { recursive: true });
  fs.writeFileSync(labelPath(stem), `${JSON.stringify(document, null, 2)}\n`);
}

/** Creates the label for an image that has none. */
export function createLabel(
  stem: string,
  document: AnnotationDocument,
): AnnotationDocument {
  if (fs.existsSync(labelPath(stem))) {
    throw new Error(`Label already exists for ${stem}`);
  }
  const created = annotationSchema.parse({ ...document, revision: 0 });
  persist(stem, created);
  return created;
}

/**
 * Replaces the label for an image. The caller's document must carry the
 * revision it was based on; a stale revision is rejected so concurrent
 * saves cannot overwrite each other.
 */
export function updateLabel(
  stem: string,
  document: AnnotationDocument,
): AnnotationDocument {
  const current = readLabel(stem);
  if (!current) {
    throw new Error(`No label exists for ${stem}`);
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
  persist(stem, next);
  return next;
}
