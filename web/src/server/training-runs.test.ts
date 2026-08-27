import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { database } from "../db/client";
import { trainingRuns } from "../db/schema";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { contentDigest, imageBlobKey, readBlob, writeBlob } from "./blobs";
import { readDatasetSnapshot } from "./dataset-snapshots";
import { readDataset } from "./datasets";
import { readModelVersion } from "./model-registry";
import {
  claimTrainingRun,
  createTrainingRun,
  failTrainingRun,
  latestAttemptEpochs,
  listTrainingEpochs,
  publishTrainingArtifact,
  readTrainingRun,
  recordTrainingEpoch,
  recoverTrainingPublications,
  reportTrainingProgress,
} from "./training-runs";
import { recordTrainingHeartbeat } from "./training-worker-store";
import { imageDigest, reviewedDataset as reviewed } from "./testing";

const CONTENTS = ["first-image", "second-image"];

async function reviewedDataset(datasetId: string) {
  const { dataset } = await reviewed(datasetId, CONTENTS);
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
  parameters: {
    ...YOLO26_SEED_SMALL_RECIPE.parameters,
    epochs: 3,
    imgsz: 768,
    batch: 4,
  },
};

function epochReport(epoch: number) {
  return {
    epoch,
    train: { box: 1.5 / epoch, cls: 2 / epoch, dfl: 1 / epoch },
    val: { box: 1.6 / epoch, cls: 2.1 / epoch, dfl: 1.1 / epoch },
    precision: 0.2 * epoch,
    recall: 0.25 * epoch,
    map50: 0.3 * epoch,
    map5095: 0.1 * epoch,
    fitness: 0.12 * epoch,
    lr: 0.001,
  };
}

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
    parameters: recipe.parameters,
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

  const snapshot = await readDatasetSnapshot(claimed.datasetSnapshotId);
  if (!snapshot) throw new Error("missing snapshot");
  expect(snapshot.images.map((image) => image.digest)).toEqual(
    CONTENTS.map(imageDigest).sort(),
  );
  expect(new Set(snapshot.images.map((image) => image.split))).toEqual(
    new Set(["train", "val"]),
  );
  for (const image of snapshot.images) {
    expect(contentDigest(readBlob(imageBlobKey(image.digest)))).toBe(
      image.digest,
    );
    expect(image.annotation.image.digest).toBe(image.digest);
  }
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

test("epochs carry the run's progress and survive a reclaimed attempt", async () => {
  await reviewedDataset("epoch-history");
  const run = await createTrainingRun("epoch-history", recipe);
  await trainer("epoch-trainer");
  await trainer("epoch-successor");
  const start = new Date();
  expect((await claimTrainingRun("epoch-trainer", start))?.id).toBe(run.id);

  const first = await recordTrainingEpoch(
    run.id,
    "epoch-trainer",
    epochReport(1),
    start,
  );
  expect(first.state).toMatchObject({ status: "running", phase: "training" });
  if (first.state.status !== "running") throw new Error("not running");
  expect(first.state.progress).toBeCloseTo(1 / 3);
  await recordTrainingEpoch(run.id, "epoch-trainer", epochReport(2), start);
  await recordTrainingEpoch(
    run.id,
    "epoch-trainer",
    { ...epochReport(2), fitness: 0.5 },
    start,
  );
  await expect(
    recordTrainingEpoch(run.id, "epoch-trainer", epochReport(4), start),
  ).rejects.toThrow(/has 3 epochs/);
  await expect(
    recordTrainingEpoch(run.id, "epoch-successor", epochReport(3), start),
  ).rejects.toThrow(/not owned/);

  const expired = new Date(start.getTime() + 10 * 60 * 1000);
  expect((await claimTrainingRun("epoch-successor", expired))?.id).toBe(run.id);
  await recordTrainingEpoch(run.id, "epoch-successor", epochReport(1), expired);

  const history = await listTrainingEpochs(run.id);
  expect(
    history.map(({ attempt, epoch, fitness }) => [attempt, epoch, fitness]),
  ).toEqual([
    [1, 1, 0.12],
    [1, 2, 0.5],
    [2, 1, 0.12],
  ]);
  expect(history[0]).toMatchObject({
    train: { box: 1.5, cls: 2, dfl: 1 },
    val: { box: 1.6, cls: 2.1, dfl: 1.1 },
    map50: 0.3,
    lr: 0.001,
  });
  const latest = await latestAttemptEpochs([run.id, "train-missing"]);
  expect([...latest.keys()]).toEqual([run.id]);
  expect(latest.get(run.id)?.map(({ epoch }) => epoch)).toEqual([1]);
  await failTrainingRun(run.id, "epoch-successor", "stopped");
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
