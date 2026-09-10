import { eq, gt } from "drizzle-orm";

import { database } from "../infra/db/client";
import {
  datasetSnapshots,
  inferenceJobs,
  trainingRuns,
} from "../infra/db/schema";
import { workerPresence } from "../../domain/workers/presence";
import type {
  WorkerActivity,
  WorkerIdentity,
} from "../../domain/workers/schema";
import { imageFilenames } from "./image-names";
import { listWorkers } from "../workers/public";

function sessionKey({ workerId, sessionId }: WorkerIdentity): string {
  return `${workerId}/${sessionId}`;
}

/** The inference image each live session is working on, by session. */
async function inferenceActivity(
  at: Date,
): Promise<Map<string, WorkerActivity>> {
  const db = await database();
  const rows = await db
    .select({
      workerId: inferenceJobs.workerId,
      sessionId: inferenceJobs.sessionId,
      digest: inferenceJobs.imageId,
    })
    .from(inferenceJobs)
    .where(gt(inferenceJobs.leaseExpiresAt, at));
  const filenames = await imageFilenames(rows.map((row) => row.digest));
  return new Map(
    rows.map((row) => [
      sessionKey(row),
      { kind: "inference", image: filenames.get(row.digest) ?? "an image" },
    ]),
  );
}

/** The training run each live session holds, by session. */
async function trainingActivity(
  at: Date,
): Promise<Map<string, WorkerActivity>> {
  const db = await database();
  const rows = await db
    .select({
      workerId: trainingRuns.workerId,
      sessionId: trainingRuns.sessionId,
      runId: trainingRuns.id,
      dataset: datasetSnapshots.datasetId,
    })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .where(gt(trainingRuns.leaseExpiresAt, at));
  return new Map(
    rows.flatMap((row) =>
      row.workerId && row.sessionId
        ? [
            [
              sessionKey({ workerId: row.workerId, sessionId: row.sessionId }),
              { kind: "training", runId: row.runId, dataset: row.dataset },
            ] as const,
          ]
        : [],
    ),
  );
}

export async function getSystemStatus() {
  const at = new Date();
  const age = (timestamp: string) =>
    Math.max(0, Math.floor((at.getTime() - Date.parse(timestamp)) / 1000));
  const [workers, inference, training] = await Promise.all([
    listWorkers(at),
    inferenceActivity(at),
    trainingActivity(at),
  ]);
  return {
    workers: workers.map((worker) => ({
      workerId: worker.workerId,
      presence: workerPresence(worker.lastSeenAt, at),
      lastSeenAt: worker.lastSeenAt,
      lastSeenSeconds: age(worker.lastSeenAt),
      activity:
        inference.get(sessionKey(worker)) ??
        training.get(sessionKey(worker)) ??
        null,
    })),
  };
}
