import { createServerFn } from "@tanstack/react-start";
import { count, and, eq, inArray, or } from "drizzle-orm";

import { database } from "../db/client";
import {
  datasetImages,
  datasetSnapshots,
  datasets,
  images,
  labels,
  modelVersions,
  prelabels,
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

/** Filename each live inference assignment is stored under. */
async function imageFilenames(
  refs: Array<{ dataset: string; digest: string }>,
): Promise<Map<string, string>> {
  const unique = [
    ...new Map(
      refs.map((ref) => [`${ref.dataset}/${ref.digest}`, ref] as const),
    ).values(),
  ];
  if (unique.length === 0) return new Map();
  const db = await database();
  const rows = await db
    .select({
      datasetId: datasetImages.datasetId,
      imageId: datasetImages.imageId,
      filename: datasetImages.filename,
    })
    .from(datasetImages)
    .where(
      or(
        ...unique.map((ref) =>
          and(
            eq(datasetImages.datasetId, ref.dataset),
            eq(datasetImages.imageId, ref.digest),
          ),
        ),
      ),
    );
  return new Map(
    rows.map((row) => [`${row.datasetId}/${row.imageId}`, row.filename]),
  );
}

async function countRows(
  table: typeof images | typeof prelabels | typeof labels,
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
  const [imageCount, prelabelCount, labelCount, trainingRunCount] =
    await Promise.all([
      countRows(images),
      countRows(prelabels),
      countRows(labels),
      countTrainingRuns(),
    ]);
  return {
    inferenceWorkers: inferenceWorkers.map((worker) => ({
      ...worker,
      presence: inferenceWorkerPresence(worker, at),
      lastSeenSeconds: age(worker.lastSeenAt),
      currentFilename: worker.current
        ? (filenames.get(
            `${worker.current.dataset}/${worker.current.digest}`,
          ) ?? null)
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
      prelabels: prelabelCount,
      labels: labelCount,
      trainingRuns: trainingRunCount,
    },
  };
});
