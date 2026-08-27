import { createServerFn } from "@tanstack/react-start";
import * as fs from "node:fs";

import type { TrainingRun } from "../training/schema";
import { readDatasetSnapshot } from "./dataset-snapshots";
import { listDatasets, listImages, readDataset } from "./datasets";
import {
  inferenceWorkerPresence,
  listInferenceWorkers,
} from "./inference-worker-store";
import { readModelVersion } from "./model-registry";
import { DATA_ROOT, LABELS_DIR, PRELABELS_DIR } from "./paths";
import { listTrainingRuns } from "./training-runs";
import {
  listTrainingWorkers,
  trainingWorkerPresence,
} from "./training-worker-store";

function countFiles(directory: string): number {
  if (!fs.existsSync(directory)) {
    return 0;
  }
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).length;
}

function datasetForModel(modelId: string, datasets: string[]): string | null {
  return (
    datasets.find((datasetId) => readDataset(datasetId)?.modelId === modelId) ??
    null
  );
}

/** The dataset a deployed version belongs to and whether it is still that dataset's choice. */
function deploymentTarget(versionId: string, datasets: string[]) {
  const version = readModelVersion(versionId);
  const datasetId = version ? datasetForModel(version.modelId, datasets) : null;
  if (!datasetId) return null;
  return {
    dataset: datasetId,
    selected: readDataset(datasetId)?.selectedModelVersionId === versionId,
  };
}

function trainingDataset(
  runId: string | null,
  runs: TrainingRun[],
): string | null {
  const run = runs.find((candidate) => candidate.id === runId);
  return run ? (readDatasetSnapshot(run.datasetSnapshotId)?.datasetId ?? null) : null;
}

export const getStatus = createServerFn({ method: "GET" }).handler(() => {
  const at = new Date();
  const datasets = listDatasets();
  const age = (timestamp: string) =>
    Math.max(0, Math.floor((at.getTime() - Date.parse(timestamp)) / 1000));
  const runs = listTrainingRuns();
  return {
    inferenceWorkers: listInferenceWorkers(at).map((worker) => ({
      ...worker,
      presence: inferenceWorkerPresence(worker, at),
      lastSeenSeconds: age(worker.lastSeenAt),
      target: deploymentTarget(worker.deployment.modelVersionId, datasets),
    })),
    trainingWorkers: listTrainingWorkers(at).map((worker) => ({
      ...worker,
      presence: trainingWorkerPresence(worker, at),
      lastSeenSeconds: age(worker.lastSeenAt),
      dataset: trainingDataset(worker.currentTrainingRunId, runs),
    })),
    server: {
      dataRoot: DATA_ROOT,
      passwordConfigured: Boolean(process.env.VITROFLOW_PASSWORD),
      inferenceWorkerTokenConfigured: Boolean(
        process.env.VITROFLOW_INFERENCE_WORKER_TOKEN,
      ),
      trainingWorkerTokenConfigured: Boolean(
        process.env.VITROFLOW_TRAINING_WORKER_TOKEN,
      ),
      datasets: datasets.length,
      images: datasets.reduce(
        (total, name) => total + listImages(name).length,
        0,
      ),
      prelabels: countFiles(PRELABELS_DIR),
      labels: countFiles(LABELS_DIR),
      trainingRuns: runs.length,
    },
  };
});
