import * as fs from "node:fs";

import type { ImageRef } from "../datasets/schema";
import {
  prelabelSchema,
  type Prelabel,
} from "../detection/schema";
import {
  samePrelabelerDescriptor,
  type PrelabelerDescriptor,
} from "../prelabelers/schema";
import {
  findImage,
  listDatasets,
  listImages,
  readDataset,
  type DatasetImage,
} from "./datasets";
import { writeAtomically } from "./files";
import { hasLabel } from "./labels";
import { PRELABELS_DIR, resolveWithin } from "./paths";
import { readPrelabeler } from "./prelabeler-registry";

/** Thrown when a worker tries to replace the prelabel a review started from. */
export class PrelabelFrozenError extends Error {
  constructor(ref: ImageRef) {
    super(`${ref.dataset}/${ref.stem} is labelled; its prelabel is frozen`);
  }
}

/** Thrown when an upload no longer matches the version selected by a dataset. */
export class PrelabelVersionMismatchError extends Error {
  constructor(ref: ImageRef) {
    super(`${ref.dataset}/${ref.stem} is assigned to another prelabeler version`);
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
  const document: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return prelabelSchema.parse(document);
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
  const dataset = readDataset(ref.dataset);
  const registered = readPrelabeler(prelabel.producer.version_id);
  if (
    !dataset ||
    dataset.selectedPrelabelerVersionId !== prelabel.producer.version_id ||
    !registered ||
    !samePrelabelerDescriptor(registered, prelabel.producer)
  ) {
    throw new PrelabelVersionMismatchError(ref);
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

/**
 * Images assigned by datasets to this immutable executable version.
 */
export function pendingImages(
  prelabeler: PrelabelerDescriptor,
): DatasetImage[] {
  return listDatasets().flatMap((datasetId) => {
    const dataset = readDataset(datasetId);
    if (dataset?.selectedPrelabelerVersionId !== prelabeler.version_id) {
      return [];
    }
    return listImages(datasetId).filter((image) => {
      if (hasLabel(image)) {
        return false;
      }
      const prelabel = readPrelabel(image);
      return (
        prelabel === null ||
        prelabel.producer.version_id !== prelabeler.version_id ||
        prelabel.producer.fingerprint !== prelabeler.fingerprint
      );
    });
  });
}
