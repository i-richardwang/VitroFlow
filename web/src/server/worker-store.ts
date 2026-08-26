import * as fs from "node:fs";

import {
  workerSchema,
  type WorkerHeartbeat,
  type WorkerPresence,
  type WorkerRecord,
} from "../workers/schema";
import { writeAtomically } from "./files";
import { WORKERS_DIR, resolveWithin } from "./paths";

/**
 * A worker heartbeats while polling for work and before every image it
 * processes; presence is derived from the heartbeat age.
 */
export const ONLINE_SECONDS = 30;
export const STALE_SECONDS = 90;
const FORGET_SECONDS = 7 * 24 * 60 * 60;

function workerPath(workerId: string): string {
  return resolveWithin(WORKERS_DIR, `${workerId}.json`);
}

function secondsSince(timestamp: string, at: Date): number {
  return (at.getTime() - Date.parse(timestamp)) / 1000;
}

export function recordHeartbeat(
  heartbeat: WorkerHeartbeat,
  at: Date = new Date(),
): WorkerRecord {
  const worker = workerSchema.parse({
    ...heartbeat,
    lastSeenAt: at.toISOString(),
  });
  writeAtomically(
    workerPath(worker.workerId),
    `${JSON.stringify(worker, null, 2)}\n`,
  );
  return worker;
}

function parseWorker(filePath: string): WorkerRecord {
  return workerSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
}

export function readWorker(workerId: string): WorkerRecord | null {
  const filePath = workerPath(workerId);
  return fs.existsSync(filePath) ? parseWorker(filePath) : null;
}

export function listWorkers(at: Date = new Date()): WorkerRecord[] {
  if (!fs.existsSync(WORKERS_DIR)) {
    return [];
  }
  const workers: WorkerRecord[] = [];
  for (const name of fs.readdirSync(WORKERS_DIR)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = resolveWithin(WORKERS_DIR, name);
    const worker = parseWorker(filePath);
    if (secondsSince(worker.lastSeenAt, at) > FORGET_SECONDS) {
      fs.rmSync(filePath, { force: true });
      continue;
    }
    workers.push(worker);
  }
  return workers.sort((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
}

export function workerPresence(
  worker: WorkerRecord,
  at: Date = new Date(),
): WorkerPresence {
  const age = secondsSince(worker.lastSeenAt, at);
  if (age <= ONLINE_SECONDS) {
    return "online";
  }
  return age <= STALE_SECONDS ? "stale" : "offline";
}
