import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import * as fs from "node:fs";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { createLabel } from "./labels";
import { readDataset } from "./datasets";
import { writeAtomically } from "./files";
import { readModelVersion } from "./model-registry";
import {
  MODEL_ARTIFACTS_DIR,
  TRAINING_RUNS_DIR,
  TRAINING_STAGING_DIR,
  resolveWithin,
} from "./paths";
import { snapshotImagePath } from "./dataset-snapshots";
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
  const dataset = readDataset(datasetId);
  if (!dataset) throw new Error("missing dataset");
  const version = readModelVersion(dataset.selectedModelVersionId);
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
    createLabel(
      { dataset: datasetId, stem },
      { ...documentFromPrelabel(prelabel), status: "complete" },
    );
  }
  return dataset;
}

const recipe = {
  ...YOLO26_SEED_SMALL_RECIPE,
  epochs: 50,
  imageSize: 768,
  batchSize: 4,
};

test("a model has at most one active training run", async () => {
  await reviewedDataset("exclusive-run");
  const run = createTrainingRun("exclusive-run", recipe);
  expect(() => createTrainingRun("exclusive-run", recipe)).toThrow(/still active/);
  recordTrainingHeartbeat({
    workerId: "exclusive-trainer",
    startedAt: "2026-08-27T00:00:00.000Z",
    device: "cuda:0",
    currentTrainingRunId: null,
  });
  expect(claimTrainingRun("exclusive-trainer")?.id).toBe(run.id);
  expect(() => createTrainingRun("exclusive-run", recipe)).toThrow(/still active/);
  failTrainingRun(run.id, "exclusive-trainer", "stopped");
  const next = createTrainingRun("exclusive-run", recipe);
  expect(next.id).not.toBe(run.id);
  expect(claimTrainingRun("exclusive-trainer")?.id).toBe(next.id);
  failTrainingRun(next.id, "exclusive-trainer", "stopped");
});

test("a training run owns an immutable self-contained snapshot", async () => {
  await reviewedDataset("snapshot-contract");
  const run = createTrainingRun("snapshot-contract", recipe);
  recordTrainingHeartbeat({
    workerId: "snapshot-trainer",
    startedAt: "2026-08-27T00:00:00.000Z",
    device: "cuda:0",
    currentTrainingRunId: null,
  });
  const claimed = claimTrainingRun("snapshot-trainer");
  expect(claimed?.id).toBe(run.id);
  expect(claimTrainingRun("snapshot-trainer")).toEqual(claimed);
  if (!claimed) throw new Error("run was not claimed");

  const snapshot = snapshotImagePath(claimed.datasetSnapshotId, 0);
  if (!snapshot) throw new Error("missing snapshot image");
  const bytes = fs.readFileSync(snapshot.path);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(snapshot.digest);
  expect(new Set([0, 1].map((index) => {
    const image = snapshotImagePath(claimed.datasetSnapshotId, index);
    return image ? fs.readFileSync(image.path).toString() : "missing";
  }))).toEqual(new Set(["first-image", "second-image"]));
  expect(() =>
    reportTrainingProgress(run.id, "another-trainer", "training", 0.5),
  ).toThrow(/not owned/);
});

test("the server publishes a candidate version idempotently without selecting it", async () => {
  const dataset = await reviewedDataset("publish-contract");
  const run = createTrainingRun("publish-contract", recipe);
  recordTrainingHeartbeat({
    workerId: "publisher",
    startedAt: "2026-08-27T00:00:00.000Z",
    device: "cuda:0",
    currentTrainingRunId: null,
  });
  expect(claimTrainingRun("publisher")?.id).toBe(run.id);
  reportTrainingProgress(run.id, "publisher", "validating", 0.95);

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
  expect(() =>
    publishTrainingArtifact(
      run.id,
      "publisher",
      new TextEncoder().encode("trained-weights"),
      {
        ...publication,
        training: {
          ...publication.training,
          runtime: { ...publication.training.runtime, version: "different" },
        },
      },
    ),
  ).toThrow(/identity does not match/);
  const completed = publishTrainingArtifact(
    run.id,
    "publisher",
    new TextEncoder().encode("trained-weights"),
    publication,
  );
  const repeated = publishTrainingArtifact(
    run.id,
    "publisher",
    new TextEncoder().encode("trained-weights"),
    publication,
  );
  expect(completed).toEqual(repeated);
  expect(() =>
    publishTrainingArtifact(
      run.id,
      "publisher",
      new TextEncoder().encode("different-weights"),
      publication,
    ),
  ).toThrow(/different artifact/);
  expect(completed.state.status).toBe("succeeded");
  if (completed.state.status !== "succeeded") throw new Error("not succeeded");

  const version = readModelVersion(completed.state.modelVersionId);
  expect(version?.source).toEqual({
    kind: "training_run",
    trainingRunId: run.id,
    datasetSnapshotId: run.datasetSnapshotId,
  });
  expect(version?.artifact.kind).toBe("ultralytics");
  expect(readDataset("publish-contract")?.selectedModelVersionId).toBe(
    dataset.selectedModelVersionId,
  );
  expect(
    fs.readFileSync(
      resolveWithin(
        MODEL_ARTIFACTS_DIR,
        completed.state.modelVersionId,
        "weights",
        "best.pt",
      ),
      "utf-8",
    ),
  ).toBe("trained-weights");
});

test("server recovery completes an interrupted durable publication", async () => {
  await reviewedDataset("recovery-contract");
  const run = createTrainingRun("recovery-contract", recipe);
  recordTrainingHeartbeat({
    workerId: "recovery-publisher",
    startedAt: "2026-08-27T00:00:00.000Z",
    device: "cuda:0",
    currentTrainingRunId: null,
  });
  const claimed = claimTrainingRun("recovery-publisher");
  if (!claimed) throw new Error("run was not claimed");
  const publication = {
    schema_version: 1,
    weights: "weights/best.pt",
    inference: {
      ready: true,
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
  const staging = resolveWithin(TRAINING_STAGING_DIR, run.id);
  fs.mkdirSync(`${staging}/weights`, { recursive: true });
  fs.writeFileSync(`${staging}/weights/best.pt`, "recovered-weights");
  fs.writeFileSync(
    `${staging}/inference.json`,
    `${JSON.stringify(publication, null, 2)}\n`,
  );
  writeAtomically(
    resolveWithin(TRAINING_RUNS_DIR, `${run.id}.json`),
    `${JSON.stringify({
      ...claimed,
      state: { status: "publishing", workerId: "recovery-publisher" },
    }, null, 2)}\n`,
  );

  expect(recoverTrainingPublications()).toEqual({
    recovered: [run.id],
    failed: [],
  });
  expect(readTrainingRun(run.id)?.state.status).toBe("succeeded");
});
