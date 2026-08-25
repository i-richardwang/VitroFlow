import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  executionSchema,
  resultSchema,
  type ExecutionIdentity,
} from "../detection/schema";
import {
  jobSchema,
  type JobImage,
  type PublishingJob,
  type QueuedJob,
  type RecognitionJob,
  type RunningJob,
  type SucceededJob,
} from "../jobs/schema";
import { writeAtomically } from "./files";
import {
  DATA_ROOT,
  JOBS_DIR,
  RUNS_DIR,
  STAGING_DIR,
  resolveWithin,
} from "./paths";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const RESULT_SUFFIXES = [".json", "_overlay.jpg", "_debug.jpg"] as const;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_RENDER_BYTES = 32 * 1024 * 1024;

function now(): string {
  return new Date().toISOString();
}

function assertIdentifier(value: string, name: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${name} must use letters, numbers, dots, dashes, or underscores`);
  }
}

function jobPath(jobId: string): string {
  return resolveWithin(JOBS_DIR, `${jobId}.json`);
}

function stagingJobDir(jobId: string): string {
  return resolveWithin(STAGING_DIR, jobId);
}

function stagingRunDir(jobId: string): string {
  return resolveWithin(stagingJobDir(jobId), "run");
}

function runDir(runId: string): string {
  return resolveWithin(RUNS_DIR, runId);
}

function persistJob(job: RecognitionJob): void {
  const parsed = jobSchema.parse(job);
  writeAtomically(jobPath(parsed.id), `${JSON.stringify(parsed, null, 2)}\n`);
}

function jobFields(job: RecognitionJob) {
  return {
    id: job.id,
    dataset: job.dataset,
    runId: job.runId,
    images: job.images,
    completedImages: job.completedImages,
    createdAt: job.createdAt,
  };
}

function resultExecution(result: ReturnType<typeof resultSchema.parse>): ExecutionIdentity {
  return executionSchema.parse({
    pipeline: result.pipeline,
    model: result.model,
    config: result.config,
  });
}

function readResultFile(directory: string, image: JobImage) {
  const resultPath = resolveWithin(directory, `${image.stem}.json`);
  if (!fs.existsSync(resultPath)) {
    throw new Error(`Missing result artifact for ${image.source}: .json`);
  }
  return resultSchema.parse(JSON.parse(fs.readFileSync(resultPath, "utf-8")));
}

function validateResultSet(job: RunningJob | PublishingJob, directory: string): void {
  if (!job.execution) {
    throw new Error(`Job ${job.id} has no execution identity`);
  }
  for (const image of job.images) {
    for (const suffix of RESULT_SUFFIXES) {
      if (!fs.existsSync(resolveWithin(directory, `${image.stem}${suffix}`))) {
        throw new Error(`Missing result artifact for ${image.source}: ${suffix}`);
      }
    }
    const result = readResultFile(directory, image);
    if (result.source !== image.source) {
      throw new Error(`Result source does not match job image: ${result.source}`);
    }
    if (!isDeepStrictEqual(resultExecution(result), job.execution)) {
      throw new Error(`Result execution identity differs for ${image.source}`);
    }
  }
}

function finalizePublishing(job: PublishingJob): SucceededJob {
  const staging = stagingRunDir(job.id);
  const destination = runDir(job.runId);
  if (fs.existsSync(staging) && fs.existsSync(destination)) {
    throw new Error(`Both staged and published results exist for ${job.runId}`);
  }
  if (!fs.existsSync(destination)) {
    validateResultSet(job, staging);
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.renameSync(staging, destination);
  }
  validateResultSet(job, destination);
  const succeeded: SucceededJob = {
    ...jobFields(job),
    status: "succeeded",
    completedImages: job.images.length,
    startedAt: job.startedAt,
    publishingAt: job.publishingAt,
    finishedAt: now(),
    execution: job.execution,
  };
  persistJob(succeeded);
  fs.rmSync(stagingJobDir(job.id), { recursive: true, force: true });
  return succeeded;
}

export function readJob(jobId: string): RecognitionJob {
  return jobSchema.parse(JSON.parse(fs.readFileSync(jobPath(jobId), "utf-8")));
}

export function listJobs(): RecognitionJob[] {
  if (!fs.existsSync(JOBS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJob(name.slice(0, -5)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createJob(
  dataset: string,
  runId: string,
  sources: Array<Omit<JobImage, "id">>,
): RecognitionJob {
  assertIdentifier(dataset, "Dataset");
  assertIdentifier(runId, "Run ID");
  if (sources.length === 0) {
    throw new Error("A job must contain at least one image");
  }
  if (fs.existsSync(runDir(runId))) {
    throw new Error(`Run already exists: ${runId}`);
  }
  if (listJobs().some((job) => job.runId === runId)) {
    throw new Error(`Run already has a job: ${runId}`);
  }

  const job: QueuedJob = {
    id: randomUUID(),
    dataset,
    runId,
    status: "queued",
    images: sources.map((source) => ({ id: randomUUID(), ...source })),
    completedImages: 0,
    createdAt: now(),
  };
  persistJob(job);
  return job;
}

export function claimNextJob(): RecognitionJob | null {
  for (const job of listJobs()) {
    if (job.status === "publishing") {
      finalizePublishing(job);
    }
  }
  const jobs = listJobs();
  const running = jobs
    .filter((job): job is RunningJob => job.status === "running")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))[0];
  if (running) {
    return running;
  }
  const queued = jobs
    .filter((job): job is QueuedJob => job.status === "queued")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
  if (!queued) {
    return null;
  }
  const runningJob: RunningJob = {
    ...jobFields(queued),
    status: "running",
    startedAt: now(),
  };
  persistJob(runningJob);
  return runningJob;
}

export function readJobImage(jobId: string, imageId: string): {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
} {
  const job = readJob(jobId);
  const image = job.images.find((candidate) => candidate.id === imageId);
  if (!image) {
    throw new Error(`Image is not part of job ${jobId}: ${imageId}`);
  }
  const filePath = resolveWithin(DATA_ROOT, image.source);
  const suffix = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  };
  return {
    bytes: new Uint8Array(fs.readFileSync(filePath)),
    contentType: contentTypes[suffix] ?? "application/octet-stream",
    filename: path.basename(filePath),
  };
}

function filePart(form: FormData, name: string, maximumBytes: number): File {
  const value = form.get(name);
  if (!(value instanceof File) || value.size === 0) {
    throw new Error(`Missing result artifact: ${name}`);
  }
  if (value.size > maximumBytes) {
    throw new Error(`Result artifact is too large: ${name}`);
  }
  return value;
}

export async function storeJobResult(
  jobId: string,
  imageId: string,
  form: FormData,
): Promise<RecognitionJob> {
  const job = readJob(jobId);
  if (job.status !== "running") {
    throw new Error(`Cannot upload results to a ${job.status} job`);
  }
  const image = job.images.find((candidate) => candidate.id === imageId);
  if (!image) {
    throw new Error(`Image is not part of job ${jobId}: ${imageId}`);
  }
  const resultFile = filePart(form, "result", MAX_RESULT_BYTES);
  const overlayFile = filePart(form, "overlay", MAX_RENDER_BYTES);
  const debugFile = filePart(form, "debug", MAX_RENDER_BYTES);
  const result = resultSchema.parse(JSON.parse(await resultFile.text()));
  if (result.source !== image.source) {
    throw new Error(`Result source does not match job image: ${result.source}`);
  }
  const execution = resultExecution(result);
  if (job.execution && !isDeepStrictEqual(job.execution, execution)) {
    throw new Error(`Execution identity differs for ${image.source}`);
  }

  const directory = stagingRunDir(jobId);
  writeAtomically(
    resolveWithin(directory, `${image.stem}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  writeAtomically(
    resolveWithin(directory, `${image.stem}_overlay.jpg`),
    new Uint8Array(await overlayFile.arrayBuffer()),
  );
  writeAtomically(
    resolveWithin(directory, `${image.stem}_debug.jpg`),
    new Uint8Array(await debugFile.arrayBuffer()),
  );

  const completedImages = job.images.filter((candidate) =>
    RESULT_SUFFIXES.every((suffix) =>
      fs.existsSync(resolveWithin(directory, `${candidate.stem}${suffix}`)),
    ),
  ).length;
  const updated: RunningJob = {
    ...jobFields(job),
    status: "running",
    startedAt: job.startedAt,
    completedImages,
    execution,
  };
  persistJob(updated);
  return updated;
}

export function completeJob(jobId: string): RecognitionJob {
  const job = readJob(jobId);
  if (job.status === "succeeded") {
    if (!fs.existsSync(runDir(job.runId))) {
      throw new Error(`Published run is missing: ${job.runId}`);
    }
    fs.rmSync(stagingJobDir(job.id), { recursive: true, force: true });
    return job;
  }
  if (job.status === "publishing") {
    return finalizePublishing(job);
  }
  if (job.status !== "running") {
    throw new Error(`Cannot complete a ${job.status} job`);
  }
  if (!job.execution) {
    throw new Error(`Job ${job.id} has no execution identity`);
  }
  validateResultSet(job, stagingRunDir(job.id));
  const publishing: PublishingJob = {
    ...jobFields(job),
    status: "publishing",
    completedImages: job.images.length,
    startedAt: job.startedAt,
    publishingAt: now(),
    execution: job.execution,
  };
  persistJob(publishing);
  return finalizePublishing(publishing);
}

export function failJob(jobId: string, error: string): RecognitionJob {
  const job = readJob(jobId);
  if (job.status === "failed") {
    return job;
  }
  if (job.status !== "running") {
    throw new Error(`Cannot fail a ${job.status} job`);
  }
  const message = error.trim() || "Worker failed";
  const failed = jobSchema.parse({
    ...jobFields(job),
    status: "failed",
    startedAt: job.startedAt,
    finishedAt: now(),
    error: message.slice(0, 2000),
    execution: job.execution,
  });
  persistJob(failed);
  return failed;
}

export function retryJob(jobId: string): RecognitionJob {
  const job = readJob(jobId);
  if (job.status !== "failed") {
    throw new Error(`Cannot retry a ${job.status} job`);
  }
  fs.rmSync(stagingJobDir(job.id), { recursive: true, force: true });
  const queued: QueuedJob = {
    ...jobFields(job),
    status: "queued",
    completedImages: 0,
  };
  persistJob(queued);
  return queued;
}
