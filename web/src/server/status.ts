import { eq, inArray } from "drizzle-orm";

import { database } from "../db/client";
import { datasetSnapshots, trainingRuns } from "../db/schema";
import { imageFilenames } from "./image-names";
import {
  inferenceWorkerPresence,
  listInferenceWorkers,
} from "./inference-worker-store";
import {
  listTrainingWorkers,
  trainingWorkerPresence,
} from "./training-worker-store";

async function runDatasets(runIds: string[]): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  const db = await database();
  const rows = await db
    .select({ runId: trainingRuns.id, dataset: datasetSnapshots.datasetId })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .where(inArray(trainingRuns.id, runIds));
  return new Map(rows.map((row) => [row.runId, row.dataset]));
}

export async function getSystemStatus() {
  const at = new Date();
  const age = (timestamp: string) =>
    Math.max(0, Math.floor((at.getTime() - Date.parse(timestamp)) / 1000));
  const [inferenceWorkers, trainingWorkers] = await Promise.all([
    listInferenceWorkers(at),
    listTrainingWorkers(at),
  ]);
  const [datasetsByRun, filenames] = await Promise.all([
    runDatasets(
      trainingWorkers.flatMap((worker) =>
        worker.currentTrainingRunId ? [worker.currentTrainingRunId] : [],
      ),
    ),
    imageFilenames(
      inferenceWorkers.flatMap((worker) =>
        worker.current ? [worker.current] : [],
      ),
    ),
  ]);
  return {
    inferenceWorkers: inferenceWorkers.map((worker) => ({
      workerId: worker.workerId,
      presence: inferenceWorkerPresence(worker, at),
      lastSeenAt: worker.lastSeenAt,
      lastSeenSeconds: age(worker.lastSeenAt),
      image: worker.current
        ? (filenames.get(worker.current) ?? "an image")
        : null,
    })),
    trainingWorkers: trainingWorkers.map((worker) => ({
      workerId: worker.workerId,
      presence: trainingWorkerPresence(worker, at),
      lastSeenAt: worker.lastSeenAt,
      lastSeenSeconds: age(worker.lastSeenAt),
      currentTrainingRunId: worker.currentTrainingRunId,
      dataset: worker.currentTrainingRunId
        ? (datasetsByRun.get(worker.currentTrainingRunId) ?? null)
        : null,
    })),
  };
}
