import * as fs from "node:fs";
import * as path from "node:path";

import { DATASET_NAME, IMAGE_STEM } from "../datasets/schema";
import { CONTENT_TYPES, listImages, type DatasetImage } from "./datasets";
import { writeAtomically } from "./files";
import { IMAGES_DIR, resolveWithin } from "./paths";

const MAX_IMAGES_PER_UPLOAD = 100;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

function stemOf(filename: string): string {
  return filename.slice(0, -path.extname(filename).length);
}

/**
 * Adds photographs to a dataset. Stems identify images, so a filename whose
 * stem already exists in the dataset is rejected regardless of extension, and
 * the whole batch is validated before anything is written.
 */
export async function addImages(
  dataset: string,
  files: File[],
): Promise<DatasetImage[]> {
  if (!DATASET_NAME.test(dataset)) {
    throw new Error(
      "Dataset names use letters, numbers, dots, dashes, and underscores",
    );
  }
  if (files.length === 0) {
    throw new Error("Select at least one image");
  }
  if (files.length > MAX_IMAGES_PER_UPLOAD) {
    throw new Error(`Upload at most ${MAX_IMAGES_PER_UPLOAD} images at a time`);
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_BYTES) {
    throw new Error("Image batch exceeds 512 MiB");
  }

  const existing = new Set(
    listImages(dataset).map((image) => image.stem.toLocaleLowerCase()),
  );
  const seen = new Set<string>();
  for (const file of files) {
    const filename = file.name;
    if (path.basename(filename) !== filename || !filename) {
      throw new Error(`Invalid image filename: ${filename}`);
    }
    if (!(path.extname(filename).toLowerCase() in CONTENT_TYPES)) {
      throw new Error(`Unsupported image type: ${filename}`);
    }
    const stem = stemOf(filename);
    if (!IMAGE_STEM.test(stem)) {
      throw new Error(`Invalid image name: ${filename}`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Image exceeds 64 MiB: ${filename}`);
    }
    const key = stem.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate image in upload: ${filename}`);
    }
    if (existing.has(key)) {
      throw new Error(`Image already in dataset: ${stem}`);
    }
    seen.add(key);
  }

  const written: string[] = [];
  try {
    for (const file of files) {
      const filePath = resolveWithin(IMAGES_DIR, dataset, file.name);
      writeAtomically(filePath, new Uint8Array(await file.arrayBuffer()));
      written.push(filePath);
    }
  } catch (error) {
    for (const filePath of written) {
      fs.rmSync(filePath, { force: true });
    }
    throw error;
  }
  const stems = new Set(files.map((file) => stemOf(file.name)));
  return listImages(dataset).filter((image) => stems.has(image.stem));
}
