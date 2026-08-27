import * as fs from "node:fs";

import {
  trainingWorkerHeartbeatSchema,
  trainingWorkerRecordSchema,
  type TrainingWorkerHeartbeat,
  type TrainingWorkerRecord,
} from "../training/workers";
import {
  WORKER_FORGET_SECONDS,
  secondsSince,
  workerPresence,
  type WorkerPresence,
} from "../workers/presence";
import { writeAtomically } from "./files";
import { TRAINING_WORKERS_DIR, resolveWithin } from "./paths";

function workerPath(workerId: string): string {
  return resolveWithin(TRAINING_WORKERS_DIR, `${workerId}.json`);
}

export function recordTrainingHeartbeat(
  value: TrainingWorkerHeartbeat,
  at: Date = new Date(),
): TrainingWorkerRecord {
  const heartbeat = trainingWorkerHeartbeatSchema.parse(value);
  const record = trainingWorkerRecordSchema.parse({
    ...heartbeat,
    lastSeenAt: at.toISOString(),
  });
  writeAtomically(
    workerPath(record.workerId),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

export function readTrainingWorker(workerId: string): TrainingWorkerRecord | null {
  const filePath = workerPath(workerId);
  return fs.existsSync(filePath)
    ? trainingWorkerRecordSchema.parse(
        JSON.parse(fs.readFileSync(filePath, "utf-8")),
      )
    : null;
}

export function listTrainingWorkers(at: Date = new Date()): TrainingWorkerRecord[] {
  if (!fs.existsSync(TRAINING_WORKERS_DIR)) return [];
  return fs
    .readdirSync(TRAINING_WORKERS_DIR)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const worker = readTrainingWorker(name.slice(0, -5));
      if (!worker) return [];
      if (secondsSince(worker.lastSeenAt, at) > WORKER_FORGET_SECONDS) {
        fs.rmSync(workerPath(worker.workerId), { force: true });
        return [];
      }
      return [worker];
    })
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

export function trainingWorkerPresence(
  worker: TrainingWorkerRecord,
  at: Date = new Date(),
): WorkerPresence {
  return workerPresence(worker.lastSeenAt, at);
}
