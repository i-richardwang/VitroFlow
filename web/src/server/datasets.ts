import * as fs from "node:fs";
import * as path from "node:path";

import {
  DATASET_NAME,
  IMAGE_STEM,
  imageRefSchema,
  type ImageRef,
} from "../datasets/schema";
import { IMAGES_DIR, LABELS_DIR, PRELABELS_DIR, resolveWithin } from "./paths";

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
  if (!fs.existsSync(IMAGES_DIR)) {
    return [];
  }
  return fs
    .readdirSync(IMAGES_DIR)
    .filter(
      (name) =>
        DATASET_NAME.test(name) &&
        fs.statSync(path.join(IMAGES_DIR, name)).isDirectory(),
    )
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
