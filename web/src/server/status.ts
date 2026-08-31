import { count, eq, inArray } from "drizzle-orm";

import { database } from "../db/client";
import {
  datasetSnapshots,
  images,
  inferenceOutcomes,
  labels,
  trainingRuns,
} from "../db/schema";
import { blobStoreDescription } from "./blobs";
import { listDatasets } from "./datasets";
import { imageFilenames } from "./image-names";
import {
  inferenceWorkerPresence,
  listInferenceWorkers,
} from "./inference-worker-store";
import { countTrainingRuns } from "./training-runs";
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

async function countRows(table: typeof images | typeof labels) {
  const db = await database();
  const [row] = await db.select({ count: count() }).from(table);
  return row?.count ?? 0;
}

async function countSuccessfulInferences(): Promise<number> {
  const db = await database();
  const [row] = await db
    .select({ count: count() })
    .from(inferenceOutcomes)
    .where(eq(inferenceOutcomes.status, "succeeded"));
  return row?.count ?? 0;
}

export async function getSystemStatus() {
  const at = new Date();
  const age = (timestamp: string) =>
    Math.max(0, Math.floor((at.getTime() - Date.parse(timestamp)) / 1000));
  const [inferenceWorkers, trainingWorkers, datasetIds] = await Promise.all([
    listInferenceWorkers(at),
    listTrainingWorkers(at),
    listDatasets(),
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
  const [imageCount, detectionCount, labelCount, trainingRunCount] =
    await Promise.all([
      countRows(images),
      countSuccessfulInferences(),
      countRows(labels),
      countTrainingRuns(),
    ]);
  return {
    inferenceWorkers: inferenceWorkers.map((worker) => ({
      ...worker,
      presence: inferenceWorkerPresence(worker, at),
      lastSeenSeconds: age(worker.lastSeenAt),
      currentFilename: worker.current
        ? (filenames.get(worker.current) ?? null)
        : null,
    })),
    trainingWorkers: trainingWorkers.map((worker) => ({
      ...worker,
      presence: trainingWorkerPresence(worker, at),
      lastSeenSeconds: age(worker.lastSeenAt),
      dataset: worker.currentTrainingRunId
        ? (datasetsByRun.get(worker.currentTrainingRunId) ?? null)
        : null,
    })),
    server: {
      blobStore: blobStoreDescription(),
      passwordConfigured: Boolean(process.env.VITROFLOW_PASSWORD),
      inferenceWorkerTokenConfigured: Boolean(
        process.env.VITROFLOW_INFERENCE_WORKER_TOKEN,
      ),
      trainingWorkerTokenConfigured: Boolean(
        process.env.VITROFLOW_TRAINING_WORKER_TOKEN,
      ),
      datasets: datasetIds.length,
      images: imageCount,
      detections: detectionCount,
      labels: labelCount,
      trainingRuns: trainingRunCount,
    },
  };
}
