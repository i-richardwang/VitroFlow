import * as fs from "node:fs";
import * as path from "node:path";

import type { RecognitionJob } from "../jobs/schema";
import { writeAtomically } from "./files";
import { createJob } from "./job-store";
import { IMAGES_DIR, resolveWithin, STAGING_DIR } from "./paths";

const IMAGE_SUFFIXES = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);
const MAX_IMAGES_PER_JOB = 100;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_BYTES = 512 * 1024 * 1024;

type UploadCandidate = {
  file: File;
  filePath: string;
  source: string;
  stem: string;
};

function collectCandidates(dataset: string, files: File[]): UploadCandidate[] {
  const names = new Set<string>();
  const stems = new Set<string>();
  const datasetDirectory = resolveWithin(IMAGES_DIR, dataset);
  const existingNames = fs.existsSync(datasetDirectory)
    ? fs.readdirSync(datasetDirectory)
    : [];

  return files.map((file) => {
    const filename = path.basename(file.name);
    if (filename !== file.name || !filename) {
      throw new Error(`Invalid image filename: ${file.name}`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Image exceeds 64 MiB: ${filename}`);
    }
    const suffix = path.extname(filename).toLowerCase();
    if (!IMAGE_SUFFIXES.has(suffix)) {
      throw new Error(`Unsupported image type: ${filename}`);
    }
    const stem = filename.slice(0, -path.extname(filename).length);
    const normalizedName = filename.toLocaleLowerCase();
    const normalizedStem = stem.toLocaleLowerCase();
    if (names.has(normalizedName) || stems.has(normalizedStem)) {
      throw new Error(`Duplicate image name: ${filename}`);
    }
    names.add(normalizedName);
    stems.add(normalizedStem);
    const identityCollision = existingNames.find(
      (existing) =>
        path.parse(existing).name.toLocaleLowerCase() === normalizedStem &&
        existing !== filename,
    );
    if (identityCollision) {
      throw new Error(
        `Image identity already exists with another filename: ${identityCollision}`,
      );
    }
    return {
      file,
      filePath: resolveWithin(IMAGES_DIR, dataset, filename),
      source: path.posix.join("images", dataset, filename),
      stem,
    };
  });
}

export async function createJobFromUpload(form: FormData): Promise<RecognitionJob> {
  const dataset = String(form.get("dataset") ?? "").trim();
  const runId = String(form.get("runId") ?? "").trim();
  const files = form
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) {
    throw new Error("Select at least one image");
  }
  if (files.length > MAX_IMAGES_PER_JOB) {
    throw new Error(`A job can contain at most ${MAX_IMAGES_PER_JOB} images`);
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) {
    throw new Error("Image batch exceeds 512 MiB");
  }

  const candidates = collectCandidates(dataset, files);
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  const uploadDirectory = fs.mkdtempSync(path.join(STAGING_DIR, "upload-"));
  const promoted: string[] = [];
  try {
    for (const candidate of candidates) {
      const bytes = new Uint8Array(await candidate.file.arrayBuffer());
      writeAtomically(
        resolveWithin(uploadDirectory, path.basename(candidate.filePath)),
        bytes,
      );
    }
    for (const candidate of candidates) {
      const stagedPath = resolveWithin(
        uploadDirectory,
        path.basename(candidate.filePath),
      );
      if (fs.existsSync(candidate.filePath)) {
        if (!fs.readFileSync(candidate.filePath).equals(fs.readFileSync(stagedPath))) {
          throw new Error(
            `Image content differs from existing source: ${candidate.source}`,
          );
        }
      } else {
        fs.mkdirSync(path.dirname(candidate.filePath), { recursive: true });
        fs.renameSync(stagedPath, candidate.filePath);
        promoted.push(candidate.filePath);
      }
    }
    return createJob(
      dataset,
      runId,
      candidates.map(({ source, stem }) => ({ source, stem })),
    );
  } catch (error) {
    for (const filePath of promoted) {
      fs.rmSync(filePath, { force: true });
    }
    throw error;
  } finally {
    fs.rmSync(uploadDirectory, { recursive: true, force: true });
  }
}
