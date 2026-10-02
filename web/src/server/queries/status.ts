import { eq } from "drizzle-orm";

import { database } from "../infra/db/client";
import {
  annotationRuns,
  datasetSnapshots,
  inferenceJobs,
  trainingRuns,
} from "../infra/db/schema";
import { workerPresence } from "../../domain/workers/presence";
import type { WorkerActivity } from "../../domain/workers/schema";
import { imageFilenames } from "./image-names";
import {
  leaseIsHeld,
  listEnrolledWorkers,
  listWorkers,
} from "../workers/public";

/**
 * A held lease belongs to its worker's current session, so each worker's
 * activity is keyed by the worker alone.
 */
async function inferenceActivity(
  at: Date,
): Promise<Map<string, WorkerActivity>> {
  const rows = await (
    await database()
  )
    .select({ workerId: inferenceJobs.workerId, digest: inferenceJobs.imageId })
    .from(inferenceJobs)
    .where(leaseIsHeld(inferenceJobs, at));
  const filenames = await imageFilenames(rows.map((row) => row.digest));
  return new Map(
    rows.map((row) => [
      row.workerId,
      { kind: "inference", image: filenames.get(row.digest) ?? "an image" },
    ]),
  );
}

async function trainingActivity(
  at: Date,
): Promise<Map<string, WorkerActivity>> {
  const rows = await (
    await database()
  )
    .select({
      workerId: trainingRuns.workerId,
      runId: trainingRuns.id,
      dataset: datasetSnapshots.datasetId,
    })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .where(leaseIsHeld(trainingRuns, at));
  return new Map(
    rows.flatMap((row) =>
      row.workerId
        ? [
            [
              row.workerId,
              { kind: "training", runId: row.runId, dataset: row.dataset },
            ] as const,
          ]
        : [],
    ),
  );
}

async function annotationActivity(
  at: Date,
): Promise<Map<string, WorkerActivity>> {
  const rows = await (
    await database()
  )
    .select({
      workerId: annotationRuns.workerId,
      runId: annotationRuns.id,
      imageId: annotationRuns.imageId,
    })
    .from(annotationRuns)
    .where(leaseIsHeld(annotationRuns, at));
  const filenames = await imageFilenames(rows.map((row) => row.imageId));
  return new Map(
    rows.flatMap((row) =>
      row.workerId
        ? [
            [
              row.workerId,
              {
                kind: "annotation",
                runId: row.runId,
                image: filenames.get(row.imageId) ?? row.imageId,
              },
            ] as const,
          ]
        : [],
    ),
  );
}

/**
 * Every enrolled worker with its latest session: presence, what it is doing,
 * and how long ago it was heard from. A worker that never connected has none.
 */
export async function getSystemStatus() {
  const at = new Date();
  const age = (timestamp: string) =>
    Math.max(0, Math.floor((at.getTime() - Date.parse(timestamp)) / 1000));
  const [enrolled, sessions, inference, training, annotation] =
    await Promise.all([
      listEnrolledWorkers(),
      listWorkers(),
      inferenceActivity(at),
      trainingActivity(at),
      annotationActivity(at),
    ]);
  const sessionOf = new Map(
    sessions.map((session) => [session.workerId, session]),
  );
  return {
    workers: enrolled.map((workerId) => {
      const session = sessionOf.get(workerId);
      if (!session) {
        return {
          workerId,
          presence: "offline" as const,
          lastSeenSeconds: null,
          activity: null,
        };
      }
      return {
        workerId,
        presence: workerPresence(session.lastSeenAt, at),
        lastSeenSeconds: age(session.lastSeenAt),
        activity:
          annotation.get(workerId) ??
          inference.get(workerId) ??
          training.get(workerId) ??
          null,
      };
    }),
  };
}
