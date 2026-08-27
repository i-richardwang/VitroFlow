import * as fs from "node:fs";
import * as path from "node:path";

import {
  DATASET_NAME,
  IMAGE_STEM,
  datasetSchema,
  imageRefSchema,
  type Dataset,
  type ImageRef,
} from "../datasets/schema";
import { createAtomically, writeAtomically } from "./files";
import {
  ensureDatasetModel,
  readModelVersion,
} from "./model-registry";
import {
  DATASETS_DIR,
  IMAGES_DIR,
  LABELS_DIR,
  PRELABELS_DIR,
  resolveWithin,
} from "./paths";

export const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

export interface DatasetImage extends ImageRef {
  /** Path relative to the data root, as documents reference it. */
  source: string;
  filePath: string;
}

function datasetDir(dataset: string): string {
  if (!DATASET_NAME.test(dataset)) {
    throw new Error(`Invalid dataset name: ${dataset}`);
  }
  return resolveWithin(IMAGES_DIR, dataset);
}

function datasetPath(dataset: string): string {
  if (!DATASET_NAME.test(dataset)) {
    throw new Error(`Invalid dataset name: ${dataset}`);
  }
  return resolveWithin(DATASETS_DIR, `${dataset}.json`);
}

export function readDataset(dataset: string): Dataset | null {
  const filePath = datasetPath(dataset);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const record = datasetSchema.parse(
    JSON.parse(fs.readFileSync(filePath, "utf-8")),
  );
  if (record.id !== dataset) {
    throw new Error(`Dataset record ${record.id} does not match ${dataset}`);
  }
  return record;
}

function createDataset(dataset: string): Dataset | null {
  const defaultVersion = ensureDatasetModel(dataset);
  const record = datasetSchema.parse({
    schemaVersion: 1,
    id: dataset,
    modelId: dataset,
    selectedModelVersionId: defaultVersion.id,
  });
  return createAtomically(
    datasetPath(dataset),
    `${JSON.stringify(record, null, 2)}\n`,
  )
    ? record
    : null;
}

export function ensureDataset(dataset: string): boolean {
  if (readDataset(dataset)) {
    return false;
  }
  return createDataset(dataset) !== null;
}

export function selectModelVersion(
  dataset: string,
  versionId: string,
): Dataset {
  const current = readDataset(dataset);
  if (!current) {
    throw new Error(`Unknown dataset: ${dataset}`);
  }
  const version = readModelVersion(versionId);
  if (!version) {
    throw new Error(`Unknown model version: ${versionId}`);
  }
  if (version.modelId !== current.modelId) {
    throw new Error(
      `Model version ${versionId} belongs to ${version.modelId}, not ${current.modelId}`,
    );
  }
  const next = datasetSchema.parse({
    ...current,
    selectedModelVersionId: versionId,
  });
  writeAtomically(datasetPath(dataset), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function imageFromFilename(
  dataset: string,
  filename: string,
): DatasetImage | null {
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  if (!(extension.toLowerCase() in CONTENT_TYPES) || !IMAGE_STEM.test(stem)) {
    return null;
  }
  return {
    dataset,
    stem,
    source: path.posix.join("images", dataset, filename),
    filePath: path.join(IMAGES_DIR, dataset, filename),
  };
}

export function listDatasets(): string[] {
  if (!fs.existsSync(DATASETS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(DATASETS_DIR)
    .filter(
      (name) =>
        name.endsWith(".json") && DATASET_NAME.test(name.slice(0, -5)),
    )
    .map((name) => name.slice(0, -5))
    .filter((dataset) => readDataset(dataset) !== null)
    .sort();
}

export function listImages(dataset: string): DatasetImage[] {
  const directory = datasetDir(dataset);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .map((filename) => imageFromFilename(dataset, filename))
    .filter((image): image is DatasetImage => image !== null)
    .sort((left, right) => left.stem.localeCompare(right.stem));
}

export function findImage(ref: ImageRef): DatasetImage | null {
  const { dataset, stem } = imageRefSchema.parse(ref);
  return listImages(dataset).find((image) => image.stem === stem) ?? null;
}

export function readImageFile(
  ref: ImageRef,
): { body: Uint8Array<ArrayBuffer>; contentType: string } | null {
  const image = findImage(ref);
  if (!image) {
    return null;
  }
  return {
    body: new Uint8Array(fs.readFileSync(image.filePath)),
    contentType: CONTENT_TYPES[path.extname(image.filePath).toLowerCase()],
  };
}

/** Removes the photograph together with everything derived from it. */
export function removeImage(ref: ImageRef): void {
  const image = findImage(ref);
  if (!image) {
    throw new Error(`No image ${ref.stem} in dataset ${ref.dataset}`);
  }
  fs.rmSync(image.filePath, { force: true });
  for (const root of [PRELABELS_DIR, LABELS_DIR]) {
    fs.rmSync(resolveWithin(root, ref.dataset, `${ref.stem}.json`), {
      force: true,
    });
  }
}
