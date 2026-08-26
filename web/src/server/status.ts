import { createServerFn } from "@tanstack/react-start";
import * as fs from "node:fs";

import { listDatasets, listImages } from "./datasets";
import { DATA_ROOT, LABELS_DIR, PRELABELS_DIR } from "./paths";
import { listWorkers, workerPresence } from "./worker-store";

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
  return {
    workers: listWorkers(at).map((worker) => ({
      ...worker,
      presence: workerPresence(worker, at),
      lastSeenSeconds: Math.max(
        0,
        Math.floor((at.getTime() - Date.parse(worker.lastSeenAt)) / 1000),
      ),
    })),
    server: {
      dataRoot: DATA_ROOT,
      passwordConfigured: Boolean(process.env.VITROFLOW_PASSWORD),
      workerTokenConfigured: Boolean(process.env.VITROFLOW_WORKER_TOKEN),
      datasets: datasets.length,
      images: datasets.reduce(
        (total, name) => total + listImages(name).length,
        0,
      ),
      prelabels: countFiles(PRELABELS_DIR),
      labels: countFiles(LABELS_DIR),
    },
  };
});
