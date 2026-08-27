import { createServerFn } from "@tanstack/react-start";
import * as fs from "node:fs";

import { listDatasets, listImages } from "./datasets";
import { DATA_ROOT, LABELS_DIR, PRELABELS_DIR } from "./paths";
import {
  inferenceWorkerPresence,
  listInferenceWorkers,
} from "./inference-worker-store";
import {
  listTrainingWorkers,
  trainingWorkerPresence,
} from "./training-worker-store";
import { listTrainingRuns } from "./training-runs";

function countFiles(directory: string): number {
  if (!fs.existsSync(directory)) {
    return 0;
  }
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).length;
}

export const getStatus = createServerFn({ method: "GET" }).handler(() => {
  const at = new Date();
  const datasets = listDatasets();
  const age = (timestamp: string) =>
    Math.max(0, Math.floor((at.getTime() - Date.parse(timestamp)) / 1000));
  return {
    inferenceWorkers: listInferenceWorkers(at).map((worker) => ({
      ...worker,
      presence: inferenceWorkerPresence(worker, at),
      lastSeenSeconds: age(worker.lastSeenAt),
    })),
    trainingWorkers: listTrainingWorkers(at).map((worker) => ({
      ...worker,
      presence: trainingWorkerPresence(worker, at),
      lastSeenSeconds: age(worker.lastSeenAt),
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
      trainingRuns: listTrainingRuns().length,
    },
  };
});
