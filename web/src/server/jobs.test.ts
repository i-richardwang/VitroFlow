import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { makeResult } from "../annotation/testing";
import {
  claimNextJob,
  completeJob,
  failJob,
  readJob,
  readJobImage,
  retryJob,
  storeJobResult,
} from "./job-store";
import { createJobFromUpload } from "./job-upload";
import { DATA_ROOT } from "./paths";
import { LEASE_SECONDS, recordHeartbeat } from "./worker-store";

function resultExecution() {
  const { pipeline, model, config } = makeResult([]);
  return { pipeline, model, config };
}

function resultArtifacts(source: string, pipeline = "a"): FormData {
  const result = makeResult([]);
  result.source = source;
  result.pipeline.fingerprint = pipeline.repeat(64);
  const artifacts = new FormData();
  artifacts.set(
    "result",
    new File([JSON.stringify(result)], "result.json", {
      type: "application/json",
    }),
  );
  artifacts.set("overlay", new File(["overlay"], "overlay.jpg"));
  artifacts.set("debug", new File(["debug"], "debug.jpg"));
  return artifacts;
}

async function createJob(dataset: string, runId: string, filename: string) {
  const upload = new FormData();
  upload.set("dataset", dataset);
  upload.set("runId", runId);
  upload.append("images", new File(["image"], filename));
  return createJobFromUpload(upload);
}

describe("recognition jobs", () => {
  test("publishes complete results and completes idempotently", async () => {
    const created = await createJob("batch", "run-a", "sample.jpg");
    expect(created.status).toBe("queued");
    expect(readJobImage(created.id, created.images[0].id).filename).toBe(
      "sample.jpg",
    );

    const claimed = claimNextJob("worker-a");
    expect(claimed?.id).toBe(created.id);
    expect(claimed?.status).toBe("running");
    expect(claimNextJob("worker-a")?.id).toBe(created.id);

    const uploading = await storeJobResult(
      created.id,
      created.images[0].id,
      resultArtifacts(created.images[0].source),
    );
    expect(uploading.completedImages).toBe(1);
    expect(fs.existsSync(path.join(DATA_ROOT, "runs", "run-a"))).toBe(false);

    const completed = completeJob(created.id);
    expect(completed.status).toBe("succeeded");
    expect(completeJob(created.id)).toEqual(completed);
    expect(
      fs.existsSync(path.join(DATA_ROOT, "runs", "run-a", "sample.json")),
    ).toBe(true);
  });

  test("recovers a publishing job after the result directory moved", async () => {
    const created = await createJob("recovery", "run-recovery", "recover.jpg");
    expect(claimNextJob("worker-a")?.id).toBe(created.id);
    await storeJobResult(
      created.id,
      created.images[0].id,
      resultArtifacts(created.images[0].source),
    );

    const current = readJob(created.id);
    if (current.status !== "running" || !current.execution) {
      throw new Error("Expected a running job with an execution identity");
    }
    fs.writeFileSync(
      path.join(DATA_ROOT, "jobs", `${created.id}.json`),
      `${JSON.stringify(
        {
          id: current.id,
          dataset: current.dataset,
          runId: current.runId,
          images: current.images,
          createdAt: current.createdAt,
          startedAt: current.startedAt,
          execution: current.execution,
          status: "publishing",
          completedImages: current.images.length,
          publishingAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    const destination = path.join(DATA_ROOT, "runs", current.runId);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(
      path.join(DATA_ROOT, "staging", current.id, "run"),
      destination,
    );

    expect(completeJob(created.id).status).toBe("succeeded");
  });

  test("rejects mixed execution identities", async () => {
    const upload = new FormData();
    upload.set("dataset", "identity");
    upload.set("runId", "run-identity");
    upload.append("images", new File(["one"], "one.jpg"));
    upload.append("images", new File(["two"], "two.jpg"));
    const created = await createJobFromUpload(upload);
    expect(claimNextJob("worker-a")?.id).toBe(created.id);

    await storeJobResult(
      created.id,
      created.images[0].id,
      resultArtifacts(created.images[0].source, "a"),
    );
    await expect(
      storeJobResult(
        created.id,
        created.images[1].id,
        resultArtifacts(created.images[1].source, "b"),
      ),
    ).rejects.toThrow(/identity differs/);
    failJob(created.id, "expected mismatch");
  });

  test("requeues failed work and removes partial results", async () => {
    const created = await createJob("retry", "run-retry", "retry.jpg");
    expect(claimNextJob("worker-a")?.id).toBe(created.id);
    await storeJobResult(
      created.id,
      created.images[0].id,
      resultArtifacts(created.images[0].source),
    );
    const staging = path.join(DATA_ROOT, "staging", created.id);
    expect(fs.existsSync(staging)).toBe(true);

    failJob(created.id, "temporary failure");
    expect(readJob(created.id).status).toBe("failed");
    expect(retryJob(created.id).status).toBe("queued");
    expect(fs.existsSync(staging)).toBe(false);
    expect(claimNextJob("worker-a")?.id).toBe(created.id);
    failJob(created.id, "test complete");
  });

  test("reuses unchanged source images for a later run", async () => {
    await createJob("shared", "shared-a", "shared.jpg");

    const second = new FormData();
    second.set("dataset", "shared");
    second.set("runId", "shared-b");
    second.append("images", new File(["image"], "shared.jpg"));
    expect((await createJobFromUpload(second)).runId).toBe("shared-b");

    const changed = new FormData();
    changed.set("dataset", "shared");
    changed.set("runId", "shared-c");
    changed.append("images", new File(["changed"], "shared.jpg"));
    await expect(createJobFromUpload(changed)).rejects.toThrow(
      /content differs/,
    );

    const first = claimNextJob("worker-a");
    if (!first || first.status !== "running") {
      throw new Error("Expected the first shared job to be running");
    }
    failJob(first.id, "test complete");
    const secondJob = claimNextJob("worker-a");
    if (!secondJob || secondJob.status !== "running") {
      throw new Error("Expected the second shared job to be running");
    }
    failJob(secondJob.id, "test complete");
  });

  test("hands a running job to another worker only after its lease lapses", async () => {
    const created = await createJob("lease", "run-lease", "lease.jpg");
    const heartbeat = {
      workerId: "worker-lease",
      startedAt: "2026-01-01T00:00:00.000Z",
      execution: resultExecution(),
      currentJobId: null,
    };
    recordHeartbeat(heartbeat);
    expect(claimNextJob("worker-lease")?.id).toBe(created.id);

    expect(claimNextJob("worker-other")).toBeNull();

    await storeJobResult(
      created.id,
      created.images[0].id,
      resultArtifacts(created.images[0].source),
    );
    recordHeartbeat(
      heartbeat,
      new Date(Date.now() - (LEASE_SECONDS + 1) * 1000),
    );
    const resumed = claimNextJob("worker-other");
    expect(resumed?.id).toBe(created.id);
    expect(resumed?.workerId).toBe("worker-other");
    expect(resumed?.completedImageIds).toEqual([created.images[0].id]);
    expect(readJob(created.id)).toMatchObject({
      status: "running",
      workerId: "worker-other",
    });
    failJob(created.id, "test complete");
  });

  test("rolls back source ingestion when job creation fails", async () => {
    const created = await createJob(
      "transaction",
      "run-transaction",
      "first.jpg",
    );
    const duplicate = new FormData();
    duplicate.set("dataset", "transaction");
    duplicate.set("runId", "run-transaction");
    duplicate.append("images", new File(["second"], "second.jpg"));

    await expect(createJobFromUpload(duplicate)).rejects.toThrow(
      /already has a job/,
    );
    expect(
      fs.existsSync(
        path.join(DATA_ROOT, "images", "transaction", "second.jpg"),
      ),
    ).toBe(false);
    expect(
      fs
        .readdirSync(path.join(DATA_ROOT, "staging"))
        .some((name) => name.startsWith("upload-")),
    ).toBe(false);

    expect(claimNextJob("worker-a")?.id).toBe(created.id);
    failJob(created.id, "test complete");
  });

  test("rejects batches beyond the public upload limit", async () => {
    const upload = new FormData();
    upload.set("dataset", "oversized");
    upload.set("runId", "oversized");
    for (let index = 0; index < 101; index += 1) {
      upload.append("images", new File(["x"], `${index}.jpg`));
    }
    await expect(createJobFromUpload(upload)).rejects.toThrow(/at most 100/);
  });

  test("rejects oversized Worker artifacts", async () => {
    const created = await createJob(
      "artifacts",
      "run-artifacts",
      "artifact.jpg",
    );
    expect(claimNextJob("worker-a")?.id).toBe(created.id);
    const artifacts = resultArtifacts(created.images[0].source);
    artifacts.set(
      "result",
      new File([new Uint8Array(4 * 1024 * 1024 + 1)], "result.json"),
    );
    await expect(
      storeJobResult(created.id, created.images[0].id, artifacts),
    ).rejects.toThrow(/too large/);
    failJob(created.id, "test complete");
  });
});
