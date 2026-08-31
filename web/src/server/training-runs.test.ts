import { expect, test } from "bun:test";

import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import {
  blobExists,
  contentDigest,
  imageBlobKey,
  modelWeightsBlobKey,
  putImmutableBlob,
  requireBlob,
} from "./blobs";
import { readDatasetSnapshot } from "./dataset-snapshots";
import { collectUnreferencedModelWeights } from "./model-weight-collection";
import { readModelVersion } from "./model-registry";
import {
  claimTrainingRun,
  countActiveTrainingRuns,
  countTrainingRuns,
  createTrainingRun,
  enterTrainingPhase,
  failTrainingRun,
  listTrainingEpochs,
  listTrainingRunSummaries,
  publishTrainingArtifact,
  recordTrainingEpoch,
  renewTrainingLease,
} from "./training-runs";
import { recordTrainingHeartbeat } from "./training-worker-store";
import { imageDigest, reviewedDataset as reviewed } from "./testing";
import type { TrainingWorkerIdentity } from "../training/workers";

const CONTENTS = ["first-image", "second-image"];

async function reviewedDataset(datasetId: string) {
  const { dataset } = await reviewed(datasetId, CONTENTS);
  return dataset;
}

function owner(workerId: string, sessionId = `${workerId}-session`) {
  return { workerId, sessionId } satisfies TrainingWorkerIdentity;
}

async function trainer(workerId: string) {
  const identity = owner(workerId);
  await recordTrainingHeartbeat({
    workerId,
    sessionId: identity.sessionId,
    startedAt: "2026-08-27T00:00:00.000Z",
    device: "cuda:0",
    memoryBytes: 24 * 1024 ** 3,
    currentTrainingRunId: null,
  });
  return identity;
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
    train: {
      box: 1.5 / epoch,
      classification: 2 / epoch,
      regression: 1 / epoch,
    },
    val: {
      box: 1.6 / epoch,
      classification: 2.1 / epoch,
      regression: 1.1 / epoch,
    },
    precision: 0.2 * epoch,
    recall: 0.25 * epoch,
    map50: 0.3 * epoch,
    map50To95: 0.1 * epoch,
    fitness: 0.12 * epoch,
    learningRate: 0.001,
  };
}

const publication = {
  schemaVersion: 1 as const,
  weights: "weights/best.pt" as const,
  inference: {
    ready: true as const,
    confidence: 0.42,
    imageSize: 768,
    maxDetections: 500,
    endToEnd: false,
  },
  validation: {
    precision: 0.5,
    recall: 0.4,
    map50: 0.8,
    map50To95: 0.4,
    fitness: 0.44,
  },
  training: {
    baseModel: recipe.baseModel,
    parameters: recipe.parameters,
    runtime: recipe.runtime,
  },
};

test("a model has at most one active training run", async () => {
  await reviewedDataset("exclusive-run");
  const run = await createTrainingRun("exclusive-run", recipe);
  expect(await countTrainingRuns("exclusive-run")).toBe(1);
  expect(await countActiveTrainingRuns(run.modelId)).toBe(1);
  await expect(createTrainingRun("exclusive-run", recipe)).rejects.toThrow(
    /still active/,
  );
  const trainerOwner = await trainer("exclusive-trainer");
  expect((await claimTrainingRun(trainerOwner))?.id).toBe(run.id);
  await expect(createTrainingRun("exclusive-run", recipe)).rejects.toThrow(
    /still active/,
  );
  await failTrainingRun(run.id, trainerOwner, "stopped");
  expect(await countActiveTrainingRuns(run.modelId)).toBe(0);
  const next = await createTrainingRun("exclusive-run", recipe);
  expect(next.id).not.toBe(run.id);
  expect((await claimTrainingRun(trainerOwner))?.id).toBe(next.id);
  await failTrainingRun(next.id, trainerOwner, "stopped");
  expect(await countTrainingRuns("exclusive-run")).toBe(2);
  await expect(
    listTrainingRunSummaries({ datasetId: "exclusive-run", limit: 101 }),
  ).rejects.toThrow(/between 1 and 100/);
});

test("concurrent claims lease a run to exactly one worker", async () => {
  await reviewedDataset("contended-run");
  const run = await createTrainingRun("contended-run", recipe);
  const workers = ["contender-1", "contender-2", "contender-3"];
  const owners = await Promise.all(workers.map(trainer));
  const claims = await Promise.all(
    owners.map((worker) => claimTrainingRun(worker)),
  );
  const winners = claims.filter((claimed) => claimed?.id === run.id);
  expect(winners).toHaveLength(1);
  expect(claims.filter((claimed) => claimed === null)).toHaveLength(2);
  const winner = winners[0];
  if (!winner || winner.state.status !== "running") throw new Error("no lease");
  await failTrainingRun(
    run.id,
    { workerId: winner.state.workerId, sessionId: winner.state.sessionId },
    "stopped",
  );
});

test("a training run owns an immutable self-contained snapshot", async () => {
  await reviewedDataset("snapshot-contract");
  const run = await createTrainingRun("snapshot-contract", recipe);
  await trainer("snapshot-trainer");
  const claimed = await claimTrainingRun(owner("snapshot-trainer"));
  expect(claimed?.id).toBe(run.id);
  expect(await claimTrainingRun(owner("snapshot-trainer"))).toEqual(claimed);
  if (!claimed) throw new Error("run was not claimed");

  const snapshot = await readDatasetSnapshot(claimed.datasetSnapshotId);
  if (!snapshot) throw new Error("missing snapshot");
  expect(snapshot.images.map((image) => image.digest)).toEqual(
    (await Promise.all(CONTENTS.map(imageDigest))).sort(),
  );
  expect(new Set(snapshot.images.map((image) => image.split))).toEqual(
    new Set(["train", "val"]),
  );
  for (const image of snapshot.images) {
    expect(contentDigest(await requireBlob(imageBlobKey(image.digest)))).toBe(
      image.digest,
    );
    expect(image.annotation.image.digest).toBe(image.digest);
  }
  await expect(
    renewTrainingLease(run.id, owner("another-trainer")),
  ).rejects.toThrow(/not owned/);
  await failTrainingRun(run.id, owner("snapshot-trainer"), "stopped");
});

test("the server publishes a candidate version idempotently without selecting it", async () => {
  const dataset = await reviewedDataset("publish-contract");
  const run = await createTrainingRun("publish-contract", recipe);
  await trainer("publisher");
  expect((await claimTrainingRun(owner("publisher")))?.id).toBe(run.id);
  await enterTrainingPhase(run.id, owner("publisher"), "training");
  await enterTrainingPhase(run.id, owner("publisher"), "validating");

  const weights = new TextEncoder().encode("trained-weights");
  await expect(
    publishTrainingArtifact(run.id, owner("publisher"), weights, {
      ...publication,
      training: {
        ...publication.training,
        runtime: { ...publication.training.runtime, version: "different" },
      },
    }),
  ).rejects.toThrow(/identity does not match/);
  const completed = await publishTrainingArtifact(
    run.id,
    owner("publisher"),
    weights,
    publication,
  );
  const repeated = await publishTrainingArtifact(
    run.id,
    owner("publisher"),
    weights,
    publication,
  );
  expect(completed).toEqual(repeated);
  await expect(
    publishTrainingArtifact(
      run.id,
      owner("publisher"),
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
    trainingAttempt: completed.attempt,
    datasetSnapshotId: run.datasetSnapshotId,
  });
  expect(version?.artifact.kind).toBe("ultralytics");
  if (
    !version ||
    version.source.kind !== "training_run" ||
    version.artifact.kind !== "ultralytics"
  ) {
    throw new Error("missing ultralytics version");
  }
  expect(dataset.modelId).toBe(version.modelId);
  expect(
    new TextDecoder().decode(
      await requireBlob(
        modelWeightsBlobKey(
          run.id,
          version.source.trainingAttempt,
          version.artifact.weights.digest,
        ),
      ),
    ),
  ).toBe("trained-weights");
});

test("an interrupted upload cannot constrain a reclaimed run", async () => {
  await reviewedDataset("publication-reclaim");
  const run = await createTrainingRun("publication-reclaim", recipe);
  await trainer("original-publisher");
  await trainer("replacement-publisher");
  const started = new Date("2026-08-27T00:00:00.000Z");
  const original = await claimTrainingRun(owner("original-publisher"), started);
  if (!original) throw new Error("run was not claimed");

  const abandoned = new TextEncoder().encode("abandoned-weights");
  await putImmutableBlob(
    modelWeightsBlobKey(run.id, original.attempt, contentDigest(abandoned)),
    abandoned,
  );
  const replacement = new TextEncoder().encode("replacement-weights");
  const reclaimed = await claimTrainingRun(
    owner("replacement-publisher"),
    new Date(started.getTime() + 6 * 60 * 1000),
  );
  expect(reclaimed?.id).toBe(run.id);
  if (!reclaimed) throw new Error("run was not reclaimed");
  const completed = await publishTrainingArtifact(
    run.id,
    owner("replacement-publisher"),
    replacement,
    publication,
  );

  expect(completed.state.status).toBe("succeeded");
  const abandonedKey = modelWeightsBlobKey(
    run.id,
    original.attempt,
    contentDigest(abandoned),
  );
  const replacementKey = modelWeightsBlobKey(
    run.id,
    reclaimed.attempt,
    contentDigest(replacement),
  );
  expect(await collectUnreferencedModelWeights()).toContain(abandonedKey);
  expect(await blobExists(abandonedKey)).toBeFalse();
  expect(await requireBlob(replacementKey)).toEqual(replacement);
});

test("model weights remain rooted by their active attempt", async () => {
  await reviewedDataset("publication-active-root");
  const run = await createTrainingRun("publication-active-root", recipe);
  await trainer("active-publisher");
  const active = await claimTrainingRun(owner("active-publisher"));
  if (!active) throw new Error("run was not claimed");
  const weights = new TextEncoder().encode("in-flight-weights");
  const key = modelWeightsBlobKey(
    run.id,
    active.attempt,
    contentDigest(weights),
  );
  await putImmutableBlob(key, weights);

  expect(await collectUnreferencedModelWeights()).not.toContain(key);
  expect(await requireBlob(key)).toEqual(weights);
  await failTrainingRun(run.id, owner("active-publisher"), "stopped");
  expect(await collectUnreferencedModelWeights()).toContain(key);
  expect(await blobExists(key)).toBeFalse();
});

test("epochs carry the run's progress and survive a reclaimed attempt", async () => {
  await reviewedDataset("epoch-history");
  const run = await createTrainingRun("epoch-history", recipe);
  await trainer("epoch-trainer");
  await trainer("epoch-successor");
  const start = new Date();
  expect((await claimTrainingRun(owner("epoch-trainer"), start))?.id).toBe(
    run.id,
  );
  await expect(
    recordTrainingEpoch(run.id, owner("epoch-trainer"), epochReport(1), start),
  ).rejects.toThrow(/while preparing/);
  await enterTrainingPhase(run.id, owner("epoch-trainer"), "training", start);

  const first = await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer"),
    epochReport(1),
    start,
  );
  expect(first.state).toMatchObject({ status: "running", phase: "training" });
  if (first.state.status !== "running") throw new Error("not running");
  expect(first.state.progress).toBeCloseTo(0.05 + 0.85 / 3);
  await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer"),
    epochReport(2),
    start,
  );
  await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer"),
    { ...epochReport(2), fitness: 0.5 },
    start,
  );
  const renewed = await renewTrainingLease(
    run.id,
    owner("epoch-trainer"),
    start,
  );
  expect(renewed.state).toMatchObject({
    status: "running",
    phase: "training",
  });
  if (renewed.state.status !== "running") throw new Error("not running");
  expect(renewed.state.progress).toBeCloseTo(0.05 + (0.85 * 2) / 3);
  const repeatedEarlier = await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer"),
    epochReport(1),
    start,
  );
  if (repeatedEarlier.state.status !== "running")
    throw new Error("not running");
  expect(repeatedEarlier.state.progress).toBeCloseTo(0.05 + (0.85 * 2) / 3);
  await expect(
    recordTrainingEpoch(run.id, owner("epoch-trainer"), epochReport(4), start),
  ).rejects.toThrow(/has 3 epochs/);
  await expect(
    recordTrainingEpoch(
      run.id,
      owner("epoch-successor"),
      epochReport(3),
      start,
    ),
  ).rejects.toThrow(/not owned/);

  const expired = new Date(start.getTime() + 10 * 60 * 1000);
  expect((await claimTrainingRun(owner("epoch-successor"), expired))?.id).toBe(
    run.id,
  );
  await enterTrainingPhase(
    run.id,
    owner("epoch-successor"),
    "training",
    expired,
  );
  await recordTrainingEpoch(
    run.id,
    owner("epoch-successor"),
    epochReport(1),
    expired,
  );

  const history = await listTrainingEpochs(run.id);
  expect(
    history.map(({ attempt, epoch, fitness }) => [attempt, epoch, fitness]),
  ).toEqual([
    [1, 1, 0.12],
    [1, 2, 0.5],
    [2, 1, 0.12],
  ]);
  expect(history[0]).toMatchObject({
    train: { box: 1.5, classification: 2, regression: 1 },
    val: { box: 1.6, classification: 2.1, regression: 1.1 },
    map50: 0.3,
    learningRate: 0.001,
  });
  expect(
    await listTrainingRunSummaries({ datasetId: "epoch-history", limit: 1 }),
  ).toMatchObject([
    {
      dataset: "epoch-history",
      run: { id: run.id },
      completed: 1,
      best: { map50: 0.3, map50To95: 0.1 },
    },
  ]);
  const validating = await enterTrainingPhase(
    run.id,
    owner("epoch-successor"),
    "validating",
    expired,
  );
  expect(validating.state).toMatchObject({
    status: "running",
    phase: "validating",
    progress: 0.9,
  });
  await expect(
    enterTrainingPhase(run.id, owner("epoch-successor"), "training", expired),
  ).rejects.toThrow(/cannot move/);
  await expect(
    recordTrainingEpoch(
      run.id,
      owner("epoch-successor"),
      epochReport(2),
      expired,
    ),
  ).rejects.toThrow(/while validating/);
  await failTrainingRun(run.id, owner("epoch-successor"), "stopped");
});

test("a worker whose lease was reassigned can no longer report on the run", async () => {
  await reviewedDataset("lost-lease");
  const run = await createTrainingRun("lost-lease", recipe);
  await trainer("slow-trainer");
  await trainer("fast-trainer");
  const start = new Date();
  expect((await claimTrainingRun(owner("slow-trainer"), start))?.id).toBe(
    run.id,
  );
  const expired = new Date(start.getTime() + 10 * 60 * 1000);
  expect((await claimTrainingRun(owner("fast-trainer"), expired))?.id).toBe(
    run.id,
  );
  await expect(
    renewTrainingLease(run.id, owner("slow-trainer")),
  ).rejects.toThrow(/not owned/);
  await expect(
    failTrainingRun(run.id, owner("slow-trainer"), "late"),
  ).rejects.toThrow(/not owned/);
  await failTrainingRun(run.id, owner("fast-trainer"), "stopped");
});

test("a restarted worker reclaims its run as a new fenced attempt", async () => {
  await reviewedDataset("restarted-worker");
  const run = await createTrainingRun("restarted-worker", recipe);
  const oldSession = owner("restarting-trainer", "session-old");
  const newSession = owner("restarting-trainer", "session-new");
  const started = new Date("2026-08-28T00:00:00.000Z");
  await recordTrainingHeartbeat(
    {
      ...oldSession,
      startedAt: started.toISOString(),
      device: "mps",
      memoryBytes: 16 * 1024 ** 3,
      currentTrainingRunId: null,
    },
    started,
  );
  expect((await claimTrainingRun(oldSession, started))?.attempt).toBe(1);

  const restarted = new Date(started.getTime() + 1_000);
  await recordTrainingHeartbeat(
    {
      ...newSession,
      startedAt: restarted.toISOString(),
      device: "mps",
      memoryBytes: 16 * 1024 ** 3,
      currentTrainingRunId: null,
    },
    restarted,
  );
  await expect(
    renewTrainingLease(run.id, oldSession, restarted),
  ).rejects.toThrow(/not owned/);
  const reclaimed = await claimTrainingRun(newSession, restarted);
  expect(reclaimed).toMatchObject({
    id: run.id,
    attempt: 2,
    state: { status: "running", phase: "preparing" },
  });
  await expect(
    recordTrainingHeartbeat(
      {
        ...oldSession,
        startedAt: started.toISOString(),
        device: "mps",
        memoryBytes: 16 * 1024 ** 3,
        currentTrainingRunId: run.id,
      },
      restarted,
    ),
  ).rejects.toThrow(/newer active session/);
  await failTrainingRun(run.id, newSession, "stopped");
});
