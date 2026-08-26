import * as fs from "node:fs";

import type { ImageRef } from "../datasets/schema";
import { prelabelSchema, type Prelabel } from "../detection/schema";
import {
  findImage,
  listDatasets,
  listImages,
  type DatasetImage,
} from "./datasets";
import { writeAtomically } from "./files";
import { hasLabel } from "./labels";
import { PRELABELS_DIR, resolveWithin } from "./paths";

/** Thrown when a worker tries to replace the prelabel a review started from. */
export class PrelabelFrozenError extends Error {
  constructor(ref: ImageRef) {
    super(`${ref.dataset}/${ref.stem} is labelled; its prelabel is frozen`);
  }
}

function prelabelPath({ dataset, stem }: ImageRef): string {
  return resolveWithin(PRELABELS_DIR, dataset, `${stem}.json`);
}

export function readPrelabel(ref: ImageRef): Prelabel | null {
  const filePath = prelabelPath(ref);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return prelabelSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
}

export function writePrelabel(ref: ImageRef, document: unknown): Prelabel {
  const image = findImage(ref);
  if (!image) {
    throw new Error(`No image ${ref.stem} in dataset ${ref.dataset}`);
  }
  const prelabel = prelabelSchema.parse(document);
  if (prelabel.source !== image.source) {
    throw new Error(
      `Prelabel source ${prelabel.source} does not match ${image.source}`,
    );
  }
  if (hasLabel(ref)) {
    throw new PrelabelFrozenError(ref);
  }
  writeAtomically(prelabelPath(ref), `${JSON.stringify(prelabel, null, 2)}\n`);
  return prelabel;
}

/** Drops a prelabel so the next worker pass processes the image again. */
export function discardPrelabel(ref: ImageRef): void {
  if (hasLabel(ref)) {
    throw new PrelabelFrozenError(ref);
  }
  fs.rmSync(prelabelPath(ref), { force: true });
}

export interface ExecutionFingerprints {
  pipeline: string;
  model: string;
}

/**
 * Images a worker with the given pipeline and model should process: those
 * without a prelabel, and unlabelled ones whose prelabel came from a
 * different pipeline or model.
 */
export function pendingImages(
  execution: ExecutionFingerprints,
): DatasetImage[] {
  return listDatasets().flatMap((dataset) =>
    listImages(dataset).filter((image) => {
      if (hasLabel(image)) {
        return false;
      }
      const prelabel = readPrelabel(image);
      return (
        prelabel === null ||
        prelabel.pipeline.fingerprint !== execution.pipeline ||
        prelabel.model.fingerprint !== execution.model
      );
    }),
  );
}
