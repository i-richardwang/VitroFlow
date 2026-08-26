import { createServerFn } from "@tanstack/react-start";
import * as fs from "node:fs";

import { listJobs } from "./job-store";
import { DATA_ROOT, IMAGES_DIR, LABELS_DIR, RUNS_DIR } from "./paths";
import { listWorkers, workerPresence } from "./worker-store";

function countFiles(directory: string): number {
  if (!fs.existsSync(directory)) {
    return 0;
  }
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).length;
}

function countDirectories(directory: string): number {
  if (!fs.existsSync(directory)) {
    return 0;
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;
}

export const getStatus = createServerFn({ method: "GET" }).handler(() => {
  const at = new Date();
  const jobs = listJobs();
  return {
    workers: listWorkers(at).map((worker) => ({
      ...worker,
      presence: workerPresence(worker, at),
      currentRunId:
        jobs.find(
          (job) => job.id === worker.currentJobId && job.status === "running",
        )?.runId ?? null,
    })),
    server: {
      dataRoot: DATA_ROOT,
      passwordConfigured: Boolean(process.env.VITROFLOW_PASSWORD),
      workerTokenConfigured: Boolean(process.env.VITROFLOW_WORKER_TOKEN),
      images: countFiles(IMAGES_DIR),
      runs: countDirectories(RUNS_DIR),
      labels: countFiles(LABELS_DIR),
      queuedJobs: jobs.filter((job) => job.status === "queued").length,
    },
  };
});
