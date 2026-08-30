import { createServerFn } from "@tanstack/react-start";
import { asc, count, eq, inArray } from "drizzle-orm";

import { database } from "../db/client";
import {
  datasetImages,
  datasetSnapshots,
  datasets,
  detections,
  experimentPhotos,
  images,
  labels,
  modelVersions,
  trainingRuns,
} from "../db/schema";
import { blobStoreDescription } from "./blobs";
import { listDatasets } from "./datasets";
import {
  inferenceWorkerPresence,
  listInferenceWorkers,
} from "./inference-worker-store";
import { countTrainingRuns } from "./training-runs";
import {
  listTrainingWorkers,
  trainingWorkerPresence,
} from "./training-worker-store";

/** The dataset each loaded version belongs to, in one query. */
async function versionDatasets(
  versionIds: string[],
): Promise<Map<string, string>> {
  if (versionIds.length === 0) return new Map();
  const db = await database();
  const rows = await db
    .select({ versionId: modelVersions.id, dataset: datasets.id })
    .from(modelVersions)
    .innerJoin(datasets, eq(datasets.modelId, modelVersions.modelId))
    .where(inArray(modelVersions.id, versionIds));
  return new Map(rows.map((row) => [row.versionId, row.dataset]));
}

/** The dataset each run trains on, in one query. */
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

/** A deterministic membership filename for every current dataset or experiment image. */
async function imageFilenames(digests: string[]): Promise<Map<string, string>> {
  if (digests.length === 0) return new Map();
  const db = await database();
  const [datasetRows, experimentRows] = await Promise.all([
    db
      .select({
        imageId: datasetImages.imageId,
        filename: datasetImages.filename,
      })
      .from(datasetImages)
      .where(inArray(datasetImages.imageId, digests))
      .orderBy(asc(datasetImages.addedAt), asc(datasetImages.datasetId)),
    db
      .select({
        imageId: experimentPhotos.imageId,
        filename: experimentPhotos.filename,
      })
      .from(experimentPhotos)
      .where(inArray(experimentPhotos.imageId, digests))
      .orderBy(
        asc(experimentPhotos.experimentId),
        asc(experimentPhotos.roundId),
        asc(experimentPhotos.dishLabel),
      ),
  ]);
  const names = new Map<string, string>();
  for (const row of [...datasetRows, ...experimentRows]) {
    if (!names.has(row.imageId)) names.set(row.imageId, row.filename);
  }
  return names;
}

async function countRows(
  table: typeof images | typeof detections | typeof labels,
) {
  const db = await database();
  const [row] = await db.select({ count: count() }).from(table);
  return row?.count ?? 0;
}

export const getStatus = createServerFn({ method: "GET" }).handler(async () => {
  const at = new Date();
  const age = (timestamp: string) =>
    Math.max(0, Math.floor((at.getTime() - Date.parse(timestamp)) / 1000));
  const [inferenceWorkers, trainingWorkers, datasetIds] = await Promise.all([
    listInferenceWorkers(at),
    listTrainingWorkers(at),
    listDatasets(),
  ]);
  const [datasetsByVersion, datasetsByRun, filenames] = await Promise.all([
    versionDatasets(
      inferenceWorkers.flatMap((w) => (w.loaded ? [w.loaded] : [])),
    ),
    runDatasets(
      trainingWorkers.flatMap((w) =>
        w.currentTrainingRunId ? [w.currentTrainingRunId] : [],
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
      countRows(detections),
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
      loadedDataset: worker.loaded
        ? (datasetsByVersion.get(worker.loaded) ?? null)
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
});
