import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import { database } from "../db/client";
import { trainingRuns } from "../db/schema";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { readBlob, writeBlob } from "./blobs";
import { snapshotImage } from "./dataset-snapshots";
import { readDataset } from "./datasets";
import { createLabel } from "./labels";
import { readModelVersion } from "./model-registry";
import {
  claimTrainingRun,
  createTrainingRun,
  failTrainingRun,
  publishTrainingArtifact,
  readTrainingRun,
  recoverTrainingPublications,
  reportTrainingProgress,
} from "./training-runs";
import { recordTrainingHeartbeat } from "./training-worker-store";
import { addImages } from "./upload";

async function reviewedDataset(datasetId: string) {
  await addImages(datasetId, [
    new File(["first-image"], "a.jpg"),
    new File(["second-image"], "b.jpg"),
  ]);
  const dataset = await readDataset(datasetId);
  if (!dataset) throw new Error("missing dataset");
  const version = await readModelVersion(dataset.selectedModelVersionId);
  if (!version) throw new Error("missing version");
  for (const stem of ["a", "b"]) {
    const prelabel = {
      ...makeResult([{ id: 0, x: 10, y: 10 }]),
      source: `images/${datasetId}/${stem}.jpg`,
      producer: {
        model_version_id: version.id,
        artifact_digest: version.artifact.digest,
        runtime: {
          adapter: "traditional" as const,
          fingerprint: "b".repeat(64),
        },
      },
    };
    await createLabel(
      { dataset: datasetId, stem },
      { ...documentFromPrelabel(prelabel), status: "complete" },
    );
  }
  return dataset;
}

function trainer(workerId: string) {
  return recordTrainingHeartbeat({
    workerId,
    startedAt: "2026-08-27T00:00:00.000Z",
    device: "cuda:0",
    currentTrainingRunId: null,
  });
}

const recipe = {
  ...YOLO26_SEED_SMALL_RECIPE,
  epochs: 50,
  imageSize: 768,
  batchSize: 4,
};

const publication = {
  schema_version: 1 as const,
  weights: "weights/best.pt" as const,
  inference: {
    ready: true as const,
    confidence: 0.42,
    imgsz: 768,
    max_det: 500,
    end2end: false,
  },
  validation: { "metrics/mAP50(B)": 0.8 },
  training: {
    base_model: recipe.baseModel,
    configuration: recipe.configuration,
    runtime: recipe.runtime,
  },
};

test("a model has at most one active training run", async () => {
  await reviewedDataset("exclusive-run");
  const run = await createTrainingRun("exclusive-run", recipe);
  await expect(createTrainingRun("exclusive-run", recipe)).rejects.toThrow(
    /still active/,
  );
  await trainer("exclusive-trainer");
  expect((await claimTrainingRun("exclusive-trainer"))?.id).toBe(run.id);
  await expect(createTrainingRun("exclusive-run", recipe)).rejects.toThrow(
    /still active/,
  );
  await failTrainingRun(run.id, "exclusive-trainer", "stopped");
  const next = await createTrainingRun("exclusive-run", recipe);
  expect(next.id).not.toBe(run.id);
  expect((await claimTrainingRun("exclusive-trainer"))?.id).toBe(next.id);
  await failTrainingRun(next.id, "exclusive-trainer", "stopped");
});

test("concurrent claims lease a run to exactly one worker", async () => {
  await reviewedDataset("contended-run");
  const run = await createTrainingRun("contended-run", recipe);
  const workers = ["contender-1", "contender-2", "contender-3"];
  await Promise.all(workers.map(trainer));
  const claims = await Promise.all(workers.map((id) => claimTrainingRun(id)));
  const winners = claims.filter((claimed) => claimed?.id === run.id);
  expect(winners).toHaveLength(1);
  expect(claims.filter((claimed) => claimed === null)).toHaveLength(2);
  const winner = winners[0];
  if (!winner || winner.state.status !== "running") throw new Error("no lease");
  await failTrainingRun(run.id, winner.state.workerId, "stopped");
});

test("a training run owns an immutable self-contained snapshot", async () => {
  await reviewedDataset("snapshot-contract");
  const run = await createTrainingRun("snapshot-contract", recipe);
  await trainer("snapshot-trainer");
  const claimed = await claimTrainingRun("snapshot-trainer");
  expect(claimed?.id).toBe(run.id);
  expect(await claimTrainingRun("snapshot-trainer")).toEqual(claimed);
  if (!claimed) throw new Error("run was not claimed");

  const image = await snapshotImage(claimed.datasetSnapshotId, 0);
  if (!image) throw new Error("missing snapshot image");
  const bytes = readBlob(image.key);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(image.digest);
  const contents = await Promise.all(
    [0, 1].map(async (index) => {
      const entry = await snapshotImage(claimed.datasetSnapshotId, index);
      return entry ? new TextDecoder().decode(readBlob(entry.key)) : "missing";
    }),
  );
  expect(new Set(contents)).toEqual(new Set(["first-image", "second-image"]));
  await expect(
    reportTrainingProgress(run.id, "another-trainer", "training", 0.5),
  ).rejects.toThrow(/not owned/);
  await failTrainingRun(run.id, "snapshot-trainer", "stopped");
});

test("the server publishes a candidate version idempotently without selecting it", async () => {
  const dataset = await reviewedDataset("publish-contract");
  const run = await createTrainingRun("publish-contract", recipe);
  await trainer("publisher");
  expect((await claimTrainingRun("publisher"))?.id).toBe(run.id);
  await reportTrainingProgress(run.id, "publisher", "validating", 0.95);

  const weights = new TextEncoder().encode("trained-weights");
  await expect(
    publishTrainingArtifact(run.id, "publisher", weights, {
      ...publication,
      training: {
        ...publication.training,
        runtime: { ...publication.training.runtime, version: "different" },
      },
    }),
  ).rejects.toThrow(/identity does not match/);
  const completed = await publishTrainingArtifact(
    run.id,
    "publisher",
    weights,
    publication,
  );
  const repeated = await publishTrainingArtifact(
    run.id,
    "publisher",
    weights,
    publication,
  );
  expect(completed).toEqual(repeated);
  await expect(
    publishTrainingArtifact(
      run.id,
      "publisher",
      new TextEncoder().encode("different-weights"),
      publication,
    ),
  ).rejects.toThrow(/different artifact/);
  expect(completed.state.status).toBe("succeeded");
  if (completed.state.status !== "succeeded") throw new Error("not succeeded");

  const version = await readModelVersion(completed.state.modelVersionId);
  expect(version?.source).toEqual({
    kind: "training_run",
    trainingRunId: run.id,
    datasetSnapshotId: run.datasetSnapshotId,
  });
  expect(version?.artifact.kind).toBe("ultralytics");
  expect((await readDataset("publish-contract"))?.selectedModelVersionId).toBe(
    dataset.selectedModelVersionId,
  );
  expect(
    new TextDecoder().decode(
      readBlob(
        `model-artifacts/${completed.state.modelVersionId}/weights/best.pt`,
      ),
    ),
  ).toBe("trained-weights");
});

test("server recovery completes an interrupted durable publication", async () => {
  await reviewedDataset("recovery-contract");
  const run = await createTrainingRun("recovery-contract", recipe);
  await trainer("recovery-publisher");
  const claimed = await claimTrainingRun("recovery-publisher");
  if (!claimed) throw new Error("run was not claimed");
  writeBlob(`training-staging/${run.id}/weights/best.pt`, "recovered-weights");
  writeBlob(
    `training-staging/${run.id}/inference.json`,
    `${JSON.stringify(publication, null, 2)}\n`,
  );
  const db = await database();
  await db
    .update(trainingRuns)
    .set({
      status: "publishing",
      leaseExpiresAt: null,
      phase: null,
      progress: null,
    })
    .where(eq(trainingRuns.id, run.id));

  expect(await recoverTrainingPublications()).toEqual({
    recovered: [run.id],
    failed: [],
  });
  expect((await readTrainingRun(run.id))?.state.status).toBe("succeeded");
});

test("a worker whose lease was reassigned can no longer report on the run", async () => {
  await reviewedDataset("lost-lease");
  const run = await createTrainingRun("lost-lease", recipe);
  await trainer("slow-trainer");
  await trainer("fast-trainer");
  const start = new Date();
  expect((await claimTrainingRun("slow-trainer", start))?.id).toBe(run.id);
  const expired = new Date(start.getTime() + 10 * 60 * 1000);
  expect((await claimTrainingRun("fast-trainer", expired))?.id).toBe(run.id);
  await expect(
    reportTrainingProgress(run.id, "slow-trainer", "training", 0.5),
  ).rejects.toThrow(/not owned/);
  await expect(failTrainingRun(run.id, "slow-trainer", "late")).rejects.toThrow(
    /not owned/,
  );
  await failTrainingRun(run.id, "fast-trainer", "stopped");
});
