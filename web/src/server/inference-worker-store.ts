import * as fs from "node:fs";

import {
  workerSchema,
  type InferenceWorkerHeartbeat,
  type InferenceWorkerRecord,
} from "../inference/workers";
import {
  WORKER_FORGET_SECONDS,
  secondsSince,
  workerPresence,
  type WorkerPresence,
} from "../workers/presence";
import { supportsRuntime } from "../models/schema";
import { writeAtomically } from "./files";
import { INFERENCE_WORKERS_DIR, resolveWithin } from "./paths";
import { readModelVersion } from "./model-registry";

/**
 * A worker heartbeats while polling for work and before every image it
 * processes; presence is derived from the heartbeat age.
 */
function workerPath(workerId: string): string {
  return resolveWithin(INFERENCE_WORKERS_DIR, `${workerId}.json`);
}

export function recordInferenceHeartbeat(
  heartbeat: InferenceWorkerHeartbeat,
  at: Date = new Date(),
): InferenceWorkerRecord {
  const worker = workerSchema.parse({
    ...heartbeat,
    lastSeenAt: at.toISOString(),
  });
  const version = readModelVersion(worker.deployment.modelVersionId);
  if (!version) {
    throw new Error(`Unknown model version: ${worker.deployment.modelVersionId}`);
  }
  if (version.artifact.digest !== worker.deployment.artifactDigest) {
    throw new Error("Inference deployment artifact does not match model version");
  }
  if (!supportsRuntime(version.artifact, worker.runtime)) {
    throw new Error("Inference runtime cannot execute this model artifact");
  }
  writeAtomically(
    workerPath(worker.workerId),
    `${JSON.stringify(worker, null, 2)}\n`,
  );
  return worker;
}

function parseWorker(filePath: string): InferenceWorkerRecord {
  return workerSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
}

export function readInferenceWorker(workerId: string): InferenceWorkerRecord | null {
  const filePath = workerPath(workerId);
  return fs.existsSync(filePath) ? parseWorker(filePath) : null;
}

export function listInferenceWorkers(
  at: Date = new Date(),
): InferenceWorkerRecord[] {
  if (!fs.existsSync(INFERENCE_WORKERS_DIR)) {
    return [];
  }
  const workers: InferenceWorkerRecord[] = [];
  for (const name of fs.readdirSync(INFERENCE_WORKERS_DIR)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = resolveWithin(INFERENCE_WORKERS_DIR, name);
    const worker = parseWorker(filePath);
    if (secondsSince(worker.lastSeenAt, at) > WORKER_FORGET_SECONDS) {
      fs.rmSync(filePath, { force: true });
      continue;
    }
    workers.push(worker);
  }
  return workers.sort((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
}

export function inferenceWorkerPresence(
  worker: InferenceWorkerRecord,
  at: Date = new Date(),
): WorkerPresence {
  return workerPresence(worker.lastSeenAt, at);
}
